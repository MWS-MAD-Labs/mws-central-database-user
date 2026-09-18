import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { jobLevelsApi } from '../../../src/features/master-data/api/masterDataApi.js'
import { MasterDataDialog } from '../../../src/features/master-data/components/MasterDataDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const basicResource = {
  id: 'units',
  singular: 'Unit',
  description: 'Reusable organization units.',
}

describe('MasterDataDialog', () => {
  it('validates the name and submits a normalized teaching resource payload', async () => {
    const onSubmit = mock(() => {})
    const resource = {
      ...basicResource,
      id: 'job-levels',
      singular: 'Job Level',
      teachingFlag: {
        field: 'is_teaching_role',
        checkboxLabel: 'Teaching role',
        checkboxDescription: 'Marks teaching staff.',
      },
    }
    const { user } = renderWithProviders(
      <MasterDataDialog
        dialog={{ mode: 'create' }}
        resource={resource}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Job Level name is required.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(screen.getByPlaceholderText('Enter job level name'), 'lead teacher')
    await user.click(screen.getByRole('checkbox', { name: /Teaching role/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Lead Teacher',
      is_teaching_role: true,
    })
  })

  it('blocks narrowing unit scope and displays the affected assignments', async () => {
    const onSubmit = mock(() => {})
    const resource = {
      ...basicResource,
      id: 'job-levels',
      singular: 'Job Level',
      unitScope: true,
      api: jobLevelsApi,
    }
    const fetchMock = createFetchRouter([
      { path: /^\/api\/admin\/units\?.*$/, response: jsonResponse({ data: [
        { id: 'unit-elementary', name: 'Elementary' },
        { id: 'unit-junior-high', name: 'Junior High' },
      ] }) },
      { path: '/api/admin/job-levels/level-1/reassignment-preview?unit_ids=unit-elementary&page=1&size=1', response: jsonResponse({ data: [], paging: { total_item: 1 } }) },
      { path: '/api/admin/job-levels/level-1/reassignment-preview?unit_ids=unit-elementary&page=1&size=10', response: jsonResponse({
        data: [{ employee_id: 'employee-1', full_name: 'Ari Employee', employee_number: 'EMP-001', unit_name: 'Junior High' }],
        paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
      }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <MasterDataDialog
        dialog={{ mode: 'edit', record: { id: 'level-1', name: 'Teacher', units: [] } }}
        resource={resource}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    )

    await user.click(await screen.findByRole('checkbox', { name: 'Elementary' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const impactDialog = await screen.findByRole('dialog', {
      name: "Can't narrow this job level's units yet",
    })
    expect(within(impactDialog).getByRole('link', { name: 'Ari Employee' })).toHaveAttribute(
      'href', '/employees/employee-1',
    )
    expect(within(impactDialog).getByText('EMP-001')).toBeVisible()
    expect(within(impactDialog).getByText('Junior High')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })
})
