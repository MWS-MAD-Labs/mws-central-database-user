import { describe, expect, it } from 'bun:test'
import { fireEvent, screen, within } from '@testing-library/react'
import { PermissionPopover } from '../../../src/features/application-access/components/PermissionPopover.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('PermissionPopover', () => {
  it('lists permissions grouped by area and closes on Escape', async () => {
    const { user } = renderWithProviders(
      <PermissionPopover permissions={['users.read', 'checkin.self.read', 'users.manage']} />,
    )
    await user.click(screen.getByRole('button', { name: '3 permissions' }))
    const dialog = screen.getByRole('dialog', { name: 'Permissions' })
    expect(within(dialog).getByText('users.manage')).toHaveClass('text-(--mws-burgundy)')
    expect(within(dialog).getByText('users.manage')).not.toHaveClass('bg-(--mws-soft)')
    expect(within(dialog).getByText('users')).toBeVisible()
    expect(within(dialog).getByText('checkin')).toBeVisible()
    expect(within(dialog).getByText('users.manage')).toBeVisible()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Permissions' })).not.toBeInTheDocument()
  })

  it('shows only the count when compact and closes on an outside click', async () => {
    const { user } = renderWithProviders(
      <div>
        <PermissionPopover permissions={['a.read', 'a.write']} compact />
        <p>Elsewhere</p>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: '2 permissions' })
    expect(trigger).toHaveTextContent('2')
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Permissions' })).toBeVisible()
    await user.click(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('dialog', { name: 'Permissions' })).not.toBeInTheDocument()
  })

  it('stays open while its own list scrolls and closes when the page scrolls', async () => {
    const { user } = renderWithProviders(
      <PermissionPopover permissions={Array.from({ length: 40 }, (_, index) => `area.item${index}`)} />,
    )
    await user.click(screen.getByRole('button', { name: '40 permissions' }))
    const dialog = screen.getByRole('dialog', { name: 'Permissions' })
    fireEvent.scroll(dialog)
    expect(screen.getByRole('dialog', { name: 'Permissions' })).toBeVisible()
    fireEvent.scroll(document.body)
    expect(screen.queryByRole('dialog', { name: 'Permissions' })).not.toBeInTheDocument()
  })

  it('shows plain text when there is nothing to list', () => {
    renderWithProviders(<PermissionPopover permissions={[]} />)
    expect(screen.getByText('0 permissions')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
