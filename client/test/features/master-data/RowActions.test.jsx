import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RowActions } from '../../../src/features/master-data/components/RowActions.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('RowActions', () => {
  it('shows icon buttons that are named but carry no visible text', async () => {
    const onEdit = mock(() => {})
    renderWithProviders(<RowActions onView={() => {}} onEdit={onEdit} onDelete={() => {}} />)
    for (const name of ['View', 'Edit', 'Delete']) {
      const button = screen.getByRole('button', { name })
      expect(button.getAttribute('title')).toBe(name)
      expect(button.textContent.trim()).toBe('')
    }
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalled()
  })
})
