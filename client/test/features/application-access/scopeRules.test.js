import { describe, expect, it } from 'bun:test'
import { buildScopeRules, hasRemoved } from '../../../src/features/application-access/utils/scopeRules.js'

const rules = buildScopeRules({
  units: [
    { id: 'mad', name: 'MAD Lab' },
    { id: 'ele', name: 'Elementary' },
  ],
  job_positions: [
    { id: 'coder', name: 'Coder', unit_ids: ['mad'] },
    { id: 'support', name: 'IT Support', unit_ids: ['mad', 'ele'] },
    { id: 'tutor', name: 'Tutor', unit_ids: ['ele'] },
    { id: 'aide', name: 'Aide', unit_ids: [] },
  ],
  job_levels: [
    { id: 'staff', name: 'Staff', unit_ids: [] },
    { id: 'manager', name: 'Manager', unit_ids: ['mad'] },
  ],
  pairs: {
    coder: ['staff', 'manager'],
    support: ['staff', 'manager'],
    tutor: ['staff'],
    aide: ['staff'],
  },
})

const pick = (units, positions, levels) => ({ units, positions, levels })

describe('scope rules', () => {
  it('offers every unit, levels for the selected units, and positions for units plus levels', () => {
    const allowed = rules.allowedValues(pick(['ele'], null, ['staff']))
    expect([...allowed.units].sort()).toEqual(['ele', 'mad'])
    expect([...allowed.levels]).toEqual(['staff'])
    expect([...allowed.positions].sort()).toEqual(['aide', 'support', 'tutor'])
  })

  it('returns structured short reasons for unavailable choices', () => {
    const availability = rules.availability(pick(['ele'], null, ['manager']))
    expect(availability.levels.get('manager')).toEqual({ kind: 'units', names: ['MAD Lab'] })
    expect(availability.positions.get('tutor')).toEqual({ kind: 'level' })
  })

  it('keeps a multi-unit position when one supporting unit remains', () => {
    const result = rules.settle(
      pick(['ele'], ['coder', 'support', 'tutor'], ['staff']),
      'units',
    )
    expect(result.selection.units).toEqual(['ele'])
    expect(result.selection.levels).toEqual(['staff'])
    expect(result.selection.positions).toEqual(['support', 'tutor'])
    expect(result.removed.positions).toEqual(['coder'])
  })

  it('drops a level and its positions only when no selected unit supports them', () => {
    const result = rules.settle(
      pick(['ele'], ['support', 'tutor'], ['staff', 'manager']),
      'units',
    )
    expect(result.selection.units).toEqual(['ele'])
    expect(result.selection.levels).toEqual(['staff'])
    expect(result.selection.positions).toEqual(['support', 'tutor'])
    expect(result.removed.levels).toEqual(['manager'])
  })

  it('changing levels only trims positions and never changes units', () => {
    const result = rules.settle(
      pick(['mad', 'ele'], ['coder', 'support', 'tutor', 'aide'], ['manager']),
      'levels',
    )
    expect(result.selection.units).toEqual(['mad', 'ele'])
    expect(result.selection.levels).toEqual(['manager'])
    expect(result.selection.positions).toEqual(['coder', 'support'])
    expect(result.removed.units).toEqual([])
  })

  it('changing positions never changes units or levels', () => {
    const result = rules.settle(
      pick(['mad'], ['aide'], ['staff', 'manager']),
      'positions',
    )
    expect(result.selection).toEqual({
      units: ['mad'],
      positions: ['aide'],
      levels: ['staff', 'manager'],
    })
    expect(hasRemoved(result.removed)).toBe(false)
  })

  it('clears descendants when the last unit is unchecked', () => {
    const result = rules.settle(pick([], ['coder'], ['staff']), 'units')
    expect(result.selection).toEqual({ units: [], positions: [], levels: [] })
    expect(result.removed.positions).toEqual(['coder'])
    expect(result.removed.levels).toEqual(['staff'])
  })

  it('clears positions when the last level is unchecked', () => {
    const result = rules.settle(pick(['mad'], ['coder'], []), 'levels')
    expect(result.selection).toEqual({ units: ['mad'], positions: [], levels: [] })
    expect(result.removed.positions).toEqual(['coder'])
  })

  it('does not clear descendants while switching All off to start picking', () => {
    const units = rules.settle(pick([], ['coder'], ['staff']), 'units', { wipe: false })
    expect(units.selection.positions).toEqual(['coder'])
    expect(units.selection.levels).toEqual(['staff'])

    const levels = rules.settle(pick(['mad'], ['coder'], []), 'levels', { wipe: false })
    expect(levels.selection.positions).toEqual(['coder'])
  })

  it('settles stale groups from parents to descendants without narrowing units', () => {
    const result = rules.settle(pick(['ele'], ['coder', 'support'], ['staff', 'manager']))
    expect(result.selection.units).toEqual(['ele'])
    expect(result.selection.levels).toEqual(['staff'])
    expect(result.selection.positions).toEqual(['support'])
    expect(result.removed.units).toEqual([])
  })
})
