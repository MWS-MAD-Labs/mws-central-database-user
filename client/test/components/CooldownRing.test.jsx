import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { CooldownRing } from '../../src/components/ui/CooldownRing.jsx'

describe('CooldownRing', () => {
  it('draws no ring when nothing is left to wait', () => {
    const { container } = render(<CooldownRing left={0} total={30}><button type="button">Go</button></CooldownRing>)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByRole('button', { name: 'Go' })).toBeVisible()
  })

  it('draws a burgundy arc as long as the share of the wait that is left', () => {
    const { container } = render(<CooldownRing left={15} total={60}><button type="button">Go</button></CooldownRing>)
    expect(container.querySelector('svg')).not.toBeNull()
    const arc = screen.getByTestId('cooldown-arc')
    expect(arc.getAttribute('stroke')).toBe('var(--mws-burgundy)')
    // A quarter of the wait is left, so a quarter of the ring is drawn.
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBe(75)
  })

  it('stays on the edge of the button instead of growing past it', () => {
    const { container } = render(<CooldownRing left={15} total={60}><button type="button">Go</button></CooldownRing>)
    const classes = container.querySelector('svg').getAttribute('class')
    expect(classes).toContain('inset-0')
    expect(classes).toContain('h-full')
    expect(classes).not.toContain('-inset')
    expect(classes).not.toContain('calc(100%+')
  })

  it('never goes past a whole ring', () => {
    render(<CooldownRing left={90} total={60}><button type="button">Go</button></CooldownRing>)
    expect(Number(screen.getByTestId('cooldown-arc').getAttribute('stroke-dashoffset'))).toBe(0)
  })
})
