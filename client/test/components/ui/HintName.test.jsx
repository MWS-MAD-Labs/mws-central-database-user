import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { HintName } from '../../../src/components/ui/HintName.jsx'
import { getEmployeeFlagBadges, getInternFlagBadges, groupHints, worstTone } from '../../../src/lib/format.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { employeeFixture } from '../../fixtures/employees.js'

const withGoogle = (hints) => ({ ...employeeFixture(), google_account: { status: 'ACTIVE', hints } })

describe('a name with hints in a list', () => {
  it('is only the name when there is nothing to look at', () => {
    renderWithProviders(<HintName name="Ari Employee" badges={getEmployeeFlagBadges(withGoogle([]))} />)
    expect(screen.getByText('Ari Employee')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows no count text and takes the colour of the worst hint', () => {
    const tone = () => screen.getByRole('button').className
    const red = renderWithProviders(<HintName name="Ari" badges={[{ key: 'a', label: 'A', tone: 'danger', category: 'Data To Review', title: 't' }, { key: 'b', label: 'B', tone: 'warn', category: 'Data To Review', title: 't' }]} />)
    expect(screen.queryByText(/Hints?$/)).not.toBeInTheDocument()
    expect(tone()).toContain('text-[#a43c41]')
    expect(screen.getByRole('button', { name: 'Ari, 2 hints' })).toBeVisible()
    red.unmount()

    const amber = renderWithProviders(<HintName name="Ari" badges={[{ key: 'a', label: 'A', tone: 'warn', category: 'Data To Review', title: 't' }]} />)
    expect(tone()).toContain('text-[#8a6419]')
    expect(screen.getByRole('button', { name: 'Ari, 1 hint' })).toBeVisible()
    amber.unmount()

    const blue = renderWithProviders(<HintName name="Ari" badges={[{ key: 'a', label: 'A', tone: 'info', category: 'Data To Review', title: 't' }]} />)
    expect(tone()).toContain('text-[#1d4ed8]')
    blue.unmount()

    renderWithProviders(<HintName name="Ari" badges={[{ key: 'a', label: 'A', tone: 'muted', category: 'Data To Review', title: 't' }]} />)
    expect(tone()).toContain('text-(--mws-charcoal)')
    expect(tone()).toContain('underline')
  })

  it('counts the hints and lists them by category when clicked', async () => {
    const employee = {
      ...withGoogle([
        { code: 'FAILED', detail: 'Google refused' },
        { code: 'PASSWORD_OVERDUE', detail: null },
      ]),
      disciplinary_flag: { type: 'SURAT_PERINGATAN', level: 1 },
    }
    const { user } = renderWithProviders(<HintName name="Ari Employee" badges={getEmployeeFlagBadges(employee)} />)
    await user.click(screen.getByRole('button', { name: 'Ari Employee, 3 hints' }))
    const dialog = await screen.findByRole('dialog', { name: 'Hints for Ari Employee' })

    const titles = within(dialog).getAllByText(/^(Discipline|Google Account|Data To Review)$/).map((node) => node.textContent)
    expect(titles).toEqual(['Discipline', 'Google Account'])
    expect(within(dialog).getByText('Google Failed')).toBeVisible()
    expect(within(dialog).getByText(/could not be made or updated: Google refused/)).toBeVisible()
    expect(within(dialog).getByText('Password Not Set')).toBeVisible()
  })

  it('puts the categories in a fixed order and names the worst tone', () => {
    const badges = getEmployeeFlagBadges({
      ...withGoogle([{ code: 'SUSPENDED', detail: null }]),
      employment: { ...employeeFixture().employment, join_date: '2999-01-01T00:00:00.000Z' },
      disciplinary_flag: { type: 'WARNING_LETTER', level: 1 },
    })
    expect(groupHints(badges).map((group) => group.category)).toEqual(['Discipline', 'Google Account', 'Data To Review'])
    expect(worstTone(badges)).toBe('danger')
    expect(worstTone([{ tone: 'warn' }, { tone: 'muted' }])).toBe('warn')
  })

  it('describes each Google hint in plain words', () => {
    const intern = {
      identity: {},
      employment: {},
      google_account: {
        status: 'MISSING',
        hints: [
          { code: 'DELETED', detail: '2026-11-09T00:00:00.000Z' },
          { code: 'MISSING', detail: null },
          { code: 'LEFT_STILL_ACTIVE', detail: null },
          { code: 'SUSPENDED', detail: null },
        ],
      },
    }
    const titles = Object.fromEntries(getInternFlagBadges(intern).map((badge) => [badge.label, badge.title]))
    expect(titles['Google Deleted']).toContain('restored until 09 Nov 2026')
    expect(titles['Google Missing']).toContain('no longer in Google')
    expect(titles['Still Active']).toContain('Suspend it')
    expect(titles['Google Suspended']).toContain('still here')
  })
})
