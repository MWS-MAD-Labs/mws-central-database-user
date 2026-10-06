import { describe, expect, it } from 'bun:test'
import { groupFilterErrors, groupFilterPayload } from '../../../src/features/application-access/utils/groupFilterState.js'

const picked = (units) => ({
  units: { selected: units },
  positions: { selected: null },
  levels: { selected: null },
})

describe('group filter state', () => {
  it('refuses a unit list whose picks are all left out, instead of turning it into All', () => {
    const known = new Set(['unit-1'])
    const state = picked(['legacy'])
    expect(groupFilterPayload(state, 'STUDENTS', known).unit_ids).toEqual([])
    expect(groupFilterErrors(state, 'STUDENTS', known).units).toMatch(/None of the picked units/)
  })

  it('keeps a mixed list and says nothing', () => {
    const known = new Set(['unit-1'])
    const state = picked(['legacy', 'unit-1'])
    expect(groupFilterPayload(state, 'STUDENTS', known).unit_ids).toEqual(['unit-1'])
    expect(groupFilterErrors(state, 'STUDENTS', known).units).toBeUndefined()
  })

  it('does not judge picks before the units are known', () => {
    expect(groupFilterErrors(picked(['unit-1']), 'STUDENTS', undefined).units).toBeUndefined()
  })
})
