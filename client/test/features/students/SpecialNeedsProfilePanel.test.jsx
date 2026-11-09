import { expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { StudentSpecialNeedsPanel } from '../../../src/features/students/components/sensitivePanels/StudentSpecialNeedsPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

it('shows the profile read-only and routes changes to Edit Student', async () => {
  globalThis.fetch = createFetchRouter([
    {
      path: '/api/admin/students/student-1/special-needs-profile',
      response: jsonResponse({ data: {
        student_id: 'student-1',
        needs: [{ need_type: 'LEARNING', description: 'Needs short instructions.' }],
        learning_support_summary: 'Uses visual prompts.',
        accommodations: 'Additional processing time.',
        has_professional_report: false,
        report_date: null,
        identified_date: null,
      } }),
    },
  ])
  const { user } = renderWithProviders(
    <MemoryRouter>
      <ConfirmProvider>
        <StudentSpecialNeedsPanel studentId="student-1" canWrite canViewSensitive />
      </ConfirmProvider>
    </MemoryRouter>,
    { withRouter: false },
  )

  await user.click(screen.getByRole('button', { name: 'Show Special Needs Profile' }))
  await user.click(within(screen.getByRole('dialog', { name: 'View Special Needs profile' })).getByRole('button', { name: 'View' }))
  expect(await screen.findByText('Needs short instructions.')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Edit Student' })).toHaveAttribute('href', '/students/student-1/edit?section=special-needs')
  expect(screen.queryByRole('button', { name: /Add|Remove|Edit Special Needs/ })).not.toBeInTheDocument()
})
