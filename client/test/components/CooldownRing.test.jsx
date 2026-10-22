import { describe, expect, it } from 'bun:test'
import { render, screen, waitFor } from '@testing-library/react'
import { CooldownRing } from '../../src/components/ui/CooldownRing.jsx'
import { Button } from '../../src/components/ui/Button.jsx'
import { CooldownButton } from '../../src/features/google/components/CooldownButton.jsx'

const inSeconds = (seconds) => new Date(Date.now() + seconds * 1000).toISOString()

describe('CooldownRing', () => {
  it('draws no ring when nothing is waiting', () => {
    const { container } = render(<CooldownRing waiting={false} until={null} total={30}><button type="button">Go</button></CooldownRing>)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByRole('button', { name: 'Go' })).toBeVisible()
  })

  it('starts the burgundy arc at the share of the wait that is left', () => {
    render(<CooldownRing waiting until={inSeconds(15)} total={60}><button type="button">Go</button></CooldownRing>)
    const arc = screen.getByTestId('cooldown-arc')
    expect(arc.getAttribute('stroke')).toBe('var(--mws-burgundy)')
    // A quarter of the wait is left, so a quarter of the ring is drawn.
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(75, 0)
  })

  it('never starts past a whole ring', () => {
    render(<CooldownRing waiting until={inSeconds(90)} total={60}><button type="button">Go</button></CooldownRing>)
    expect(Number(screen.getByTestId('cooldown-arc').getAttribute('stroke-dashoffset'))).toBe(0)
  })

  it('stays on the edge of the button instead of growing past it', () => {
    const { container } = render(<CooldownRing waiting until={inSeconds(15)} total={60}><button type="button">Go</button></CooldownRing>)
    const classes = container.querySelector('svg').getAttribute('class')
    expect(classes).toContain('inset-0')
    expect(classes).toContain('h-full')
    expect(classes).not.toContain('-inset')
  })
})

describe('CooldownButton', () => {
  it('turns on at the moment the wait ends, and the ring goes with it', async () => {
    const { container } = render(
      <CooldownButton until={new Date(Date.now() + 400).toISOString()} total={1} waitText="to go again" type="button" aria-label="Go">
        Go
      </CooldownButton>,
    )
    const button = screen.getByRole('button', { name: 'Go' })
    expect(button).toBeDisabled()
    expect(container.querySelector('[data-testid="cooldown-arc"]')).not.toBeNull()
    expect(button.getAttribute('title')).toMatch(/^Wait 0:01 to go again\.$/)

    await waitFor(() => expect(button).toBeEnabled(), { timeout: 1500 })
    // The ring is gone in the same moment the button is on, not before and not after.
    expect(container.querySelector('[data-testid="cooldown-arc"]')).toBeNull()
  })

  it('is on, with no ring, when there is nothing to wait for', () => {
    const { container } = render(<CooldownButton until={null} total={30} waitText="to go again" type="button" aria-label="Go">Go</CooldownButton>)
    expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('stays off for a button that is off for another reason', () => {
    render(<CooldownButton until={null} total={30} waitText="to go again" disabled type="button" aria-label="Go">Go</CooldownButton>)
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled()
  })

  it('keeps a plain Button usable next to it', () => {
    render(<Button type="button">Plain</Button>)
    expect(screen.getByRole('button', { name: 'Plain' })).toBeEnabled()
  })
})
