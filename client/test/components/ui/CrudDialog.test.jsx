import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/render.jsx'
import { CrudDialog } from '../../../src/components/ui/CrudDialog.jsx'

describe('CrudDialog', () => {
  it('renders accessible title, description, content, and footer', () => {
    renderWithProviders(
      <CrudDialog
        title="Edit student"
        description="Update the selected record."
        onClose={() => {}}
        footer={<button type="button">Save changes</button>}
      >
        <label>Full name<input /></label>
      </CrudDialog>,
    )

    expect(screen.getByRole('dialog', { name: 'Edit student' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Update the selected record.')).toBeVisible()
    expect(screen.getByLabelText('Full name')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible()
  })

  it('calls onClose from the close button', async () => {
    const onClose = mock(() => {})
    const { user } = renderWithProviders(
      <CrudDialog title="Edit student" onClose={onClose}>Content</CrudDialog>,
    )
    await user.click(screen.getByRole('button', { name: 'Close Dialog' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
