import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { GradesPanel } from '../../../src/features/academic/components/GradesPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import { paging, superAdminUser } from '../../fixtures/academic.js'

describe('GradesPanel', () => {
  it('shows a plain dash when a grade has no typical age', async () => {
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/grades(?:\?.*)?$/,
        response: jsonResponse({
          data: [
            { id: 'grade-1', name: 'Grade 1', level: 1, unit_id: 'u1', unit_name: 'Elementary', typical_age: null },
            { id: 'grade-2', name: 'Grade 2', level: 2, unit_id: 'u1', unit_name: 'Elementary', typical_age: 7 },
          ],
          paging,
        }),
      },
    ])
    renderWithProviders(
      <AuthContext.Provider value={{ user: superAdminUser }}>
        <ConfirmProvider>
          <GradesPanel />
        </ConfirmProvider>
      </AuthContext.Provider>,
    )
    const empty = (await screen.findByText('Grade 1')).closest('tr')
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent)
    const cells = within(empty).getAllByRole('cell')
    expect(cells[headers.indexOf('Typical Age')]).toHaveTextContent(/^-$/)
    expect(empty).not.toHaveTextContent('—')
    expect(within(screen.getByText('Grade 2').closest('tr')).getByText('7')).toBeVisible()
  })
})
