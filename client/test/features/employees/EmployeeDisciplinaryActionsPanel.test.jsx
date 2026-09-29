import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { EmployeeDisciplinaryActionsPanel } from '../../../src/features/employees/components/EmployeeDisciplinaryActionsPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const activeAction = {
  id: 'action-1',
  type: 'SURAT_TEGURAN',
  level: 1,
  status: 'ACTIVE',
  reason: 'Repeated lateness',
  notes: 'Discussed with employee',
  resolved_reason: null,
  issued_date: '2026-09-01T00:00:00.000Z',
  valid_until: '2027-03-01T00:00:00.000Z',
  issued_by_admin_name: 'Admin User',
  attachment_count: 1,
}

const accessRoute = {
  path: '/api/admin/employees/employee-1/disciplinary-actions/access',
  method: 'POST',
  // A factory, not a pre-built Response: this route object is reused across
  // every test in this file, and a Response body can only be read once.
  response: () => jsonResponse({ data: true }),
}

function renderPanel(canWrite = true) {
  return renderWithProviders(
    <ConfirmProvider>
      <EmployeeDisciplinaryActionsPanel employeeId="employee-1" canManage={canWrite} />
    </ConfirmProvider>,
  )
}

// Content is masked-by-default (see EmployeeDisciplinaryActionsPanel's reveal
// gate) - every test must reveal before the history query even fires.
async function reveal(user) {
  await user.click(await screen.findByRole('button', { name: 'Show Disciplinary Actions' }))
  const dialog = await screen.findByRole('dialog', { name: 'View disciplinary history' })
  await user.click(within(dialog).getByRole('button', { name: 'View' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Show Disciplinary Actions' })).not.toBeInTheDocument())
}

describe('EmployeeDisciplinaryActionsPanel', () => {
  it('renders empty history and gates write actions', async () => {
    globalThis.fetch = createFetchRouter([
      accessRoute,
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions',
        response: jsonResponse({ data: [] }),
      },
    ])

    const { user } = renderPanel(false)
    await reveal(user)

    expect(await screen.findByText('No disciplinary actions on file.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Issue Record' })).not.toBeInTheDocument()
  })

  it('issues, resolves, and revokes records with expected payloads and refetches', async () => {
    let historyReads = 0
    const fetchMock = createFetchRouter([
      accessRoute,
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions',
        response: ({ method }) => {
          if (method === 'POST') {
            return jsonResponse({ data: activeAction })
          }
          historyReads += 1
          return jsonResponse({ data: [activeAction] })
        },
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/resolve',
        method: 'PATCH',
        response: jsonResponse({ data: { ...activeAction, status: 'RESOLVED' } }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/revoke',
        method: 'PATCH',
        response: jsonResponse({ data: { ...activeAction, status: 'REVOKED' } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel()
    await reveal(user)

    await screen.findByRole('button', { name: 'Warning Letter 1' })
    await user.click(screen.getByRole('button', { name: 'Issue Record' }))
    const issueDialog = screen.getByRole('dialog', { name: 'Issue Disciplinary Record' })
    await user.click(within(issueDialog).getByRole('button', { name: 'Issue' }))
    expect(screen.getByText('Reason is required.')).toBeVisible()
    await user.type(issueDialog.querySelector('textarea'), '  Safety policy breach  ')
    await user.click(within(issueDialog).getByRole('button', { name: 'Issue' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/employees/employee-1/disciplinary-actions' &&
        options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        type: 'SURAT_TEGURAN',
        reason: 'Safety policy breach',
        validity_days: 180,
      })
    })

    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    const resolveDialog = screen.getByRole('dialog', { name: 'Resolve Warning Letter 1' })
    await user.type(
      within(resolveDialog).getByPlaceholderText('e.g. Behavior improved, issue addressed'),
      'Issue addressed',
    )
    await user.click(within(resolveDialog).getByRole('button', { name: 'Resolve' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/action-1/resolve'))
      expect(JSON.parse(call[1].body)).toEqual({ resolved_reason: 'Issue addressed' })
    })

    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    const revokeDialog = screen.getByRole('dialog', { name: 'Revoke record' })
    expect(revokeDialog).toHaveTextContent('stops counting toward escalation')
    await user.click(within(revokeDialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/action-1/revoke') && options.method === 'PATCH',
    )).toBe(true))
    await waitFor(() => expect(historyReads).toBeGreaterThanOrEqual(4))
  })

  it('keeps attachments read-only in the Details view regardless of permission', async () => {
    const attachment = {
      id: 'attachment-1',
      file_name: 'warning.pdf',
      mime_type: 'application/pdf',
      file_size: 1024,
      uploaded_at: '2026-09-01T00:00:00.000Z',
      deleted_at: null,
      preview_url: '/private-preview/attachment-1',
    }
    globalThis.fetch = createFetchRouter([
      accessRoute,
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions',
        response: jsonResponse({ data: [activeAction] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments?is_deleted=false',
        response: jsonResponse({ data: [attachment] }),
      },
    ])
    const { user } = renderPanel(false)
    await reveal(user)
    await user.click(await screen.findByRole('button', { name: 'Warning Letter 1' }))
    expect(await screen.findByText('warning.pdf')).toBeVisible()
    expect(screen.queryByText('Upload')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Show Deleted' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
  })

  it('blocks oversized uploads from the Edit dialog', async () => {
    const attachment = {
      id: 'attachment-1',
      file_name: 'warning.pdf',
      mime_type: 'application/pdf',
      file_size: 1024,
      uploaded_at: '2026-09-01T00:00:00.000Z',
      deleted_at: null,
      preview_url: '/private-preview/attachment-1',
    }
    const fetchMock = createFetchRouter([
      accessRoute,
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions',
        response: jsonResponse({ data: [activeAction] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments?is_deleted=false',
        response: jsonResponse({ data: [attachment] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments',
        method: 'POST',
        response: jsonResponse({ data: attachment }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(true)
    await reveal(user)
    await user.click(await screen.findByTitle('Edit reason/notes and manage attachments'))
    await screen.findByText('warning.pdf')
    const fileInput = document.querySelector('input[type="file"]')
    const oversized = new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      'oversized.pdf',
      { type: 'application/pdf' },
    )
    await user.upload(fileInput, oversized)

    expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/action-1/attachments') && options.method === 'POST',
    )).toBe(false)
  })

  it('edits reason and notes with a trimmed payload', async () => {
    const fetchMock = createFetchRouter([
      accessRoute,
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions',
        response: jsonResponse({ data: [activeAction] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments?is_deleted=false',
        response: jsonResponse({ data: [] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1',
        method: 'PATCH',
        response: jsonResponse({ data: activeAction }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel()
    await reveal(user)
    await screen.findByText('Repeated lateness')

    await user.click(screen.getByTitle('Edit reason/notes and manage attachments'))
    const dialog = screen.getByRole('dialog', { name: 'Edit Warning Letter 1' })
    const textareas = dialog.querySelectorAll('textarea')
    await user.clear(textareas[0])
    await user.type(textareas[0], '  Updated reason  ')
    await user.clear(textareas[1])
    await user.type(textareas[1], '  Updated notes  ')
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/disciplinary-actions/action-1') && options.method === 'PATCH')
      expect(JSON.parse(call[1].body)).toEqual({
        reason: 'Updated reason',
        notes: 'Updated notes',
      })
    })
  })

  it('uploads multipart attachments, deletes them, lists deleted files without previews, and restores them, from the Edit dialog', async () => {
    const activeAttachment = {
      id: 'attachment-1',
      file_name: 'warning.pdf',
      mime_type: 'application/pdf',
      file_size: 1024,
      uploaded_at: '2026-09-01T00:00:00.000Z',
      deleted_at: null,
      preview_url: '/private-preview/attachment-1',
    }
    const deletedImage = {
      ...activeAttachment,
      id: 'attachment-2',
      file_name: 'evidence.png',
      mime_type: 'image/png',
      deleted_at: '2026-09-17T10:00:00.000Z',
      preview_url: null,
    }
    const fetchMock = createFetchRouter([
      accessRoute,
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions',
        response: jsonResponse({ data: [activeAction] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments?is_deleted=false',
        response: jsonResponse({ data: [activeAttachment] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments?is_deleted=true',
        response: jsonResponse({ data: [deletedImage] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments',
        method: 'POST',
        response: jsonResponse({ data: activeAttachment }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments/delete/attachment-1',
        method: 'PATCH',
        response: jsonResponse({ data: { ...activeAttachment, deleted_at: '2026-09-17T10:00:00.000Z' } }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments/restore/attachment-2',
        method: 'PATCH',
        response: jsonResponse({ data: { ...deletedImage, deleted_at: null } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel()
    await reveal(user)
    await user.click(await screen.findByTitle('Edit reason/notes and manage attachments'))
    const activeRow = (await screen.findByText('warning.pdf')).closest('div.rounded-xl')

    await user.click(within(activeRow).getByRole('button'))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/attachments/delete/attachment-1') && options.method === 'PATCH',
    )).toBe(true))

    const uploadInput = (await screen.findByText('Upload')).querySelector('input')
    const uploadFile = new File(['attachment'], 'new-warning.pdf', { type: 'application/pdf' })
    await user.upload(uploadInput, uploadFile)
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/action-1/attachments') && options.method === 'POST')
      expect(call[1].body).toBeInstanceOf(FormData)
      expect(call[1].body.get('file')).toMatchObject({
        name: 'new-warning.pdf',
        type: 'application/pdf',
        size: uploadFile.size,
      })
    })

    await user.click(screen.getByRole('switch', { name: 'Show Deleted' }))
    expect(await screen.findByText('evidence.png')).toBeVisible()
    expect(screen.queryByRole('img', { name: 'evidence.png' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Deleted').length).toBeGreaterThanOrEqual(2)
    const deletedRow = screen.getByText('evidence.png').closest('div.rounded-xl')
    await user.click(within(deletedRow).getByRole('button'))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/attachments/restore/attachment-2') && options.method === 'PATCH',
    )).toBe(true))
  })

  it('renders real history and attachment error states', async () => {
    globalThis.fetch = createFetchRouter([
      accessRoute,
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions',
        response: jsonResponse({ message: 'Denied' }, 403),
      },
    ])
    const history = renderPanel(false)
    await reveal(history.user)
    expect(await screen.findByText('Disciplinary history is unavailable.')).toBeVisible()
    history.unmount()

    globalThis.fetch = createFetchRouter([
      accessRoute,
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions',
        response: jsonResponse({ data: [activeAction] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments?is_deleted=false',
        response: jsonResponse({ message: 'Unavailable' }, 503),
      },
    ])
    const attachments = renderPanel(false)
    // Already revealed this session (sessionStorage persists across the two
    // renders in this test, matching real behavior) - skip straight to it.
    await attachments.user.click(await screen.findByRole('button', { name: 'Warning Letter 1' }))
    expect(await screen.findByText('Attachments are unavailable.')).toBeVisible()
    expect(screen.queryByRole('switch', { name: 'Show Deleted' })).not.toBeInTheDocument()
  })

  it('issues with multiple attachments and tolerates a partial upload failure', async () => {
    const fetchMock = createFetchRouter([
      accessRoute,
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions',
        response: ({ method }) => method === 'POST'
          ? jsonResponse({ data: activeAction })
          : jsonResponse({ data: [activeAction] }),
      },
      {
        path: '/api/admin/employees/employee-1/disciplinary-actions/action-1/attachments',
        method: 'POST',
        response: ({ options }) => options.body.get('file').name === 'failed.pdf'
          ? jsonResponse({ message: 'Upload failed' }, 500)
          : jsonResponse({ data: { id: 'attachment-new' } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel()
    await reveal(user)
    await screen.findByText('Repeated lateness')

    await user.click(screen.getByRole('button', { name: 'Issue Record' }))
    const dialog = screen.getByRole('dialog', { name: 'Issue Disciplinary Record' })
    const inputs = dialog.querySelectorAll('input[type="file"]')
    const files = [
      new File(['ok'], 'uploaded.pdf', { type: 'application/pdf' }),
      new File(['bad'], 'failed.pdf', { type: 'application/pdf' }),
    ]
    await user.upload(inputs[0], files)
    await user.type(dialog.querySelector('textarea'), 'Policy breach')
    await user.click(within(dialog).getByRole('button', { name: 'Issue' }))

    await waitFor(() => {
      const uploads = fetchMock.mock.calls.filter(([url, options]) =>
        url.endsWith('/action-1/attachments') && options.method === 'POST')
      expect(uploads).toHaveLength(2)
      expect(uploads.map(([, options]) => options.body.get('file').name).sort()).toEqual([
        'failed.pdf',
        'uploaded.pdf',
      ])
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Issue Disciplinary Record' })).not.toBeInTheDocument())
  })
})
