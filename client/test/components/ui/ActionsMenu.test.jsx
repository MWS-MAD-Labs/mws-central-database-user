import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, screen } from '@testing-library/react'
import { ActionsMenu, ActionsMenuItem } from '../../../src/components/ui/ActionsMenu.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('ActionsMenu', () => {
  it('renders its menu through a portal and closes on outside click', async () => {
    const { user } = renderWithProviders(
      <ActionsMenu label="Student actions">
        {(close) => <ActionsMenuItem onClick={close}>View student</ActionsMenuItem>}
      </ActionsMenu>,
    )

    await user.click(screen.getByRole('button', { name: 'Student actions' }))
    expect(screen.getByRole('button', { name: 'View student' })).toBeVisible()

    await user.click(document.body)
    expect(screen.queryByRole('button', { name: 'View student' })).not.toBeInTheDocument()
  })

  it('closes on scroll and supports custom triggers', async () => {
    const { user } = renderWithProviders(
      <ActionsMenu
        label="Actions"
        renderTrigger={({ onClick, isOpen }) => (
          <button type="button" onClick={onClick}>{isOpen ? 'Close actions' : 'Open actions'}</button>
        )}
      >
        {() => <ActionsMenuItem>Archive</ActionsMenuItem>}
      </ActionsMenu>,
    )
    await user.click(screen.getByRole('button', { name: 'Open actions' }))
    expect(screen.getByRole('button', { name: 'Archive' })).toBeVisible()
    fireEvent.scroll(window)
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })

  it('honors disabled items and invokes enabled actions', async () => {
    const enabled = mock(() => {})
    const disabled = mock(() => {})
    const { user } = renderWithProviders(
      <ActionsMenu label="Actions">
        {() => (
          <>
            <ActionsMenuItem disabled onClick={disabled}>Delete</ActionsMenuItem>
            <ActionsMenuItem checked onClick={enabled}>Active</ActionsMenuItem>
          </>
        )}
      </ActionsMenu>,
    )
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Active' }))
    expect(disabled).not.toHaveBeenCalled()
    expect(enabled).toHaveBeenCalledTimes(1)
  })
})
