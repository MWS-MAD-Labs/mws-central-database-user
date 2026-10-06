import { describe, expect, it } from 'bun:test'
import { buildScopeRules, hasRemoved } from '../../../src/features/application-access/utils/scopeRules.js'

// MAD Lab and Elementary. Coder exists only in MAD Lab, Tutor only in Elementary, Aide anywhere.
// Manager is a level that only pairs with Coder and Tutor, Staff pairs with everyone.
const rules = buildScopeRules({
  units: [
    { id: 'mad', name: 'MAD Lab' },
    { id: 'ele', name: 'Elementary' },
  ],
  job_positions: [
    { id: 'coder', name: 'Coder', unit_ids: ['mad'] },
    { id: 'tutor', name: 'Tutor', unit_ids: ['ele'] },
    { id: 'aide', name: 'Aide', unit_ids: [] },
  ],
  job_levels: [
    { id: 'staff', name: 'Staff', unit_ids: [] },
    { id: 'manager', name: 'Manager', unit_ids: [] },
  ],
  pairs: { coder: ['staff', 'manager'], tutor: ['staff', 'manager'], aide: ['staff'] },
})

const pick = (units, positions, levels) => ({ units, positions, levels })

describe('scope rules', () => {
  it('offers only what still fits the other two dimensions', () => {
    const allowed = rules.allowedValues(pick(['ele'], null, null))
    expect([...allowed.positions].sort()).toEqual(['aide', 'tutor'])
    expect([...rules.allowedValues(pick(null, ['aide'], null)).levels]).toEqual(['staff'])
  })

  it('drops positions that only existed in a unit that was left out', () => {
    const result = rules.settle(pick(['ele'], ['coder', 'aide'], null))
    expect(result.selection.positions).toEqual(['aide'])
    expect(result.removed.positions).toEqual(['coder'])
  })

  it('drops a unit that no picked position can exist in any more', () => {
    const result = rules.settle(pick(['mad', 'ele'], ['tutor'], null))
    expect(result.selection.units).toEqual(['ele'])
    expect(result.removed.units).toEqual(['mad'])
  })

  it('drops units and positions that only existed through a level that was left out', () => {
    // Aide pairs only with Staff, so with just Manager it has nowhere to be.
    const result = rules.settle(pick(['mad', 'ele'], ['aide', 'coder'], ['manager']))
    expect(result.selection.positions).toEqual(['coder'])
    expect(result.selection.units).toEqual(['mad'])
    expect(result.removed.positions).toEqual(['aide'])
    expect(result.removed.units).toEqual(['ele'])
  })

  it('drops a level that no picked unit or position supports', () => {
    const result = rules.settle(pick(null, ['aide'], ['staff', 'manager']))
    expect(result.selection.levels).toEqual(['staff'])
    expect(result.removed.levels).toEqual(['manager'])
  })

  it('never touches All and does not wipe the others when one list is empty', () => {
    const all = rules.settle(pick(null, null, null))
    expect(hasRemoved(all.removed)).toBe(false)
    const none = rules.settle(pick(['mad'], [], null))
    expect(none.selection.units).toEqual(['mad'])
    expect(none.selection.positions).toEqual([])
  })

  it('trims the others to what the user just edited, and not the other way round', () => {
    // Leaving MAD Lab out drops Coder, but the unit pick stays as it is.
    const dropUnit = rules.settle(pick(['ele'], ['coder', 'aide'], null), 'units')
    expect(dropUnit.selection.units).toEqual(['ele'])
    expect(dropUnit.selection.positions).toEqual(['aide'])
    expect(dropUnit.removed.positions).toEqual(['coder'])

    // Nothing fits Elementary and Coder together: Coder goes, the level and unit stay.
    const clash = rules.settle(pick(['ele'], ['coder'], ['staff']), 'units')
    expect(clash.selection.units).toEqual(['ele'])
    expect(clash.selection.positions).toEqual([])
    expect(clash.selection.levels).toEqual(['staff'])
  })

  it('carries a removal on to what depended on it', () => {
    // Staff alone keeps every position. With only Manager, Aide cannot exist,
    // and Elementary is left without a position that can sit there.
    const staff = rules.settle(pick(['mad', 'ele'], ['aide', 'coder'], ['staff']), 'levels')
    expect(staff.selection.positions).toEqual(['aide', 'coder'])
    const manager = rules.settle(pick(['mad', 'ele'], ['aide', 'coder'], ['manager']), 'levels')
    expect(manager.selection.positions).toEqual(['coder'])
    expect(manager.selection.units).toEqual(['mad'])
    expect(manager.removed.units).toEqual(['ele'])
  })

  it('clears what the others stood on when the last value of the edited list is unchecked', () => {
    const cleared = rules.settle(pick([], ['coder'], ['staff']), 'units')
    expect(cleared.selection).toEqual({ units: [], positions: [], levels: [] })
    expect(cleared.removed.positions).toEqual(['coder'])
    expect(cleared.removed.levels).toEqual(['staff'])
    // Switching All off is only the start of picking: nothing else is touched.
    const started = rules.settle(pick([], ['coder'], ['staff']), 'units', { wipe: false })
    expect(started.selection.positions).toEqual(['coder'])
  })
})
