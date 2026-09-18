import { describe, expect, it } from 'bun:test'
import { act, screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { StudentConsentPanel } from '../../../src/features/students/components/sensitivePanels/StudentConsentPanel.jsx'
import { StudentParentsPanel } from '../../../src/features/students/components/sensitivePanels/StudentParentsPanel.jsx'
import { MAX_ATTACHMENT_SIZE_BYTES } from '../../../src/lib/fileSize.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function renderPanel(panel) {
  return renderWithProviders(<ConfirmProvider>{panel}</ConfirmProvider>)
}

describe('StudentParentsPanel', () => {
  it('validates, creates, edits, deletes, and restores parent records', async () => {
    const parent = {
      id: 'parent-1',
      type: 'MOTHER',
      full_name: 'Jordan Parent',
      phone: '0812345678',
      email: 'jordan@example.test',
      address: 'Jakarta',
      is_primary: true,
      deleted_at: null,
    }
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/students/student-1/parents?is_deleted=false',
        response: ({ method }) => method === 'GET'
          ? jsonResponse({ data: [parent] })
          : jsonResponse({ data: parent }),
      },
      { path: '/api/admin/students/student-1/parents', method: 'POST', response: jsonResponse({ data: parent }) },
      { path: '/api/admin/students/student-1/parents/parent-1', method: 'PATCH', response: jsonResponse({ data: parent }) },
      { path: '/api/admin/students/student-1/parents/delete/parent-1', method: 'PATCH', response: jsonResponse({ data: parent }) },
      {
        path: '/api/admin/students/student-1/parents?is_deleted=true',
        response: jsonResponse({ data: [{ ...parent, deleted_at: '2026-09-17T10:00:00.000Z' }] }),
      },
      { path: '/api/admin/students/student-1/parents/restore/parent-1', method: 'PATCH', response: jsonResponse({ data: parent }) },
    ])
    globalThis.fetch = fetchMock
    const { user, queryClient, unmount } = renderPanel(<StudentParentsPanel studentId="student-1" canWrite />)

    expect(await screen.findByText('Jordan Parent')).toBeVisible()
    expect(screen.getByText('Primary')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Parent' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Full name is required.')).toBeVisible()
    const createDialog = screen.getByRole('dialog', { name: 'New Parent / Guardian' })
    await user.type(createDialog.querySelector('[data-field="full_name"] input'), '  alex guardian  ')
    await user.click(screen.getByLabelText('Primary Contact'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/students/student-1/parents' &&
      options.method === 'POST' &&
      JSON.parse(options.body).full_name === 'Alex Guardian',
    )).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('dialog', { name: 'Edit Parent / Guardian' })).toBeVisible()
    const editDialog = screen.getByRole('dialog', { name: 'Edit Parent / Guardian' })
    await user.clear(editDialog.querySelector('[data-field="address"] textarea'))
    await user.type(editDialog.querySelector('[data-field="address"] textarea'), 'Bandung')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/parents/parent-1') && options.method === 'PATCH',
    )).toBe(true))

    const parentCard = screen.getByText('Jordan Parent').closest('article')
    await user.click(within(parentCard).getAllByRole('button')[1])
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/parents/delete/parent-1'))).toBe(true))

    await user.click(screen.getByRole('switch', { name: 'Show Deleted' }))
    expect(await screen.findByText('Deleted')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/parents/restore/parent-1'))).toBe(true))
    await waitFor(() => expect(screen.queryByText('Syncing')).not.toBeInTheDocument())
    await act(async () => {
      await queryClient.cancelQueries()
      queryClient.clear()
      unmount()
    })
  })

  it('disables writes for read-only users', async () => {
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/students/student-1/parents?is_deleted=false', response: jsonResponse({ data: [] }) },
    ])
    renderPanel(<StudentParentsPanel studentId="student-1" canWrite={false} />)
    expect(await screen.findByText('No parent or guardian records yet.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Parent' })).toBeDisabled()
  })
})

describe('StudentConsentPanel', () => {
  const consent = {
    id: 'consent-1',
    consent_type: 'MEDIA_CONSENT',
    status: 'SIGNED',
    signed_by: 'Jordan Parent',
    consent_date: '2026-09-01T00:00:00.000Z',
    validity_period: null,
    notes: 'School publication consent',
    deleted_at: null,
  }
  const attachment = {
    id: 'attachment-1',
    file_name: 'signed-consent.pdf',
    file_size: 1024,
    mime_type: 'application/pdf',
    preview_url: '/preview/attachment-1',
    uploaded_at: '2026-09-01T10:00:00.000Z',
    deleted_at: null,
  }

  it('restricts attachments when sensitive permission is absent', async () => {
    const fetchMock = createFetchRouter([
      { path: '/api/admin/students/student-1/consents?is_deleted=false', response: jsonResponse({ data: [consent] }) },
    ])
    globalThis.fetch = fetchMock
    renderPanel(<StudentConsentPanel studentId="student-1" canWrite canViewSensitive={false} />)
    expect(await screen.findByText('Media Consent')).toBeVisible()
    expect(screen.getByText(/Attachments are restricted/)).toBeVisible()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/attachments'))).toBe(false)
  })

  it('creates consent and manages signed attachments', async () => {
    const fetchMock = createFetchRouter([
      { path: '/api/admin/students/student-1/consents?is_deleted=false', response: jsonResponse({ data: [consent] }) },
      { path: '/api/admin/students/student-1/consents', method: 'POST', response: jsonResponse({ data: consent }) },
      { path: '/api/admin/students/student-1/consents/consent-1/attachments?is_deleted=false', response: jsonResponse({ data: [attachment] }) },
      { path: '/api/admin/students/student-1/consents/consent-1/attachments', method: 'POST', response: jsonResponse({ data: attachment }) },
      { path: '/api/admin/students/student-1/consents/consent-1/attachments/delete/attachment-1', method: 'PATCH', response: jsonResponse({ data: attachment }) },
      { path: '/api/admin/students/student-1/consents/delete/consent-1', method: 'PATCH', response: jsonResponse({ data: consent }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(<StudentConsentPanel studentId="student-1" canWrite canViewSensitive />)

    expect(await screen.findByText('signed-consent.pdf')).toBeVisible()
    expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', '/preview/attachment-1')
    expect(screen.getAllByRole('link').some((link) => link.href.includes('/download'))).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Consent' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/students/student-1/consents' && options.method === 'POST',
    )).toBe(true))

    const upload = screen.getByText('Upload').querySelector('input')
    const oversized = new File([new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1)], 'too-large.pdf', { type: 'application/pdf' })
    await user.upload(upload, oversized)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/attachments')).length).toBe(0)

    await user.upload(upload, new File(['pdf'], 'new-consent.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/attachments') && options.method === 'POST' && options.body instanceof FormData,
    )).toBe(true))

    const attachmentRow = screen.getByText('signed-consent.pdf').closest('div.rounded-xl')
    await user.click(within(attachmentRow).getAllByRole('button')[0])
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/attachments/delete/attachment-1'))).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete consent' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/consents/delete/consent-1'))).toBe(true))
  })
})
