import { describe, expect, it } from 'bun:test'
import {
  ageOn,
  childrenPayload,
  childrenValueFromResponse,
  countsAreStale,
  DEFAULT_ALLOWANCE_RULE,
  describeChildren,
  describeChildrenWithAllowance,
  emptyChildrenValue,
  findChildrenProblems,
  findCountsProblems,
  summarizeChildren,
  summarizeCounts,
} from '../../../src/features/employees/utils/childrenRules.js'

const today = '2026-10-28'
const child = (birth_date, relation = 'BIOLOGICAL') => ({ birth_date, relation })

describe('children rules in the form', () => {
  it('counts whole years and turns over on the birthday', () => {
    expect(ageOn('2003-10-28', today)).toBe(23)
    expect(ageOn('2003-10-29', today)).toBe(22)
  })

  it('splits at 23 and ignores rows without a date yet', () => {
    const summary = summarizeChildren([child('2003-10-28'), child('2003-10-29'), child('2015-01-01'), child('')], today)
    expect(summary).toEqual({ total: 3, under_23: 2, age_23_plus: 1, allowance_eligible: 2 })
  })

  it('says it in words', () => {
    expect(describeChildren({ total: 0, under_23: 0, age_23_plus: 0 })).toBe('No Children')
    expect(describeChildren({ total: 1, under_23: 1, age_23_plus: 0 })).toBe('1 Child')
    expect(describeChildren({ total: 3, under_23: 2, age_23_plus: 1 })).toBe('3 Children')
    expect(describeChildrenWithAllowance({ total: 3, allowance_eligible: 2 })).toBe('3 Children, 2 For Allowance')
    expect(describeChildrenWithAllowance({ total: 0, allowance_eligible: 0 })).toBe('')
  })

  it('rejects a 20 year old child of a 30 year old, and accepts exactly 18 years apart', () => {
    const base = { maritalStatus: 'MARRIED', today }
    expect(findChildrenProblems({ ...base, parentBirthDate: '1996-10-28', children: [child('2006-10-28')] }).byRow[0])
      .toContain('at least 18 years younger')
    expect(findChildrenProblems({ ...base, parentBirthDate: '1990-05-10', children: [child('2008-05-10')] }).hasProblems).toBe(false)
    expect(findChildrenProblems({ ...base, parentBirthDate: '1990-05-10', children: [child('2008-05-09')] }).hasProblems).toBe(true)
  })

  it('lets an adopted or step child be any younger age but not older than the employee', () => {
    const base = { maritalStatus: 'MARRIED', parentBirthDate: '1990-05-10', today }
    expect(findChildrenProblems({ ...base, children: [child('2000-01-01', 'ADOPTED')] }).hasProblems).toBe(false)
    expect(findChildrenProblems({ ...base, children: [child('1985-01-01', 'STEP')] }).hasProblems).toBe(true)
  })

  it('lets a single employee have an adopted child only', () => {
    const base = { maritalStatus: 'SINGLE', parentBirthDate: '1980-01-01', today }
    expect(findChildrenProblems({ ...base, children: [child('2015-01-01', 'ADOPTED')] }).hasProblems).toBe(false)
    expect(findChildrenProblems({ ...base, children: [child('2015-01-01')] }).byRow[0]).toContain('single')
  })

  it('waits for the date before judging a row, and for the birth date before judging the gap', () => {
    expect(findChildrenProblems({ maritalStatus: 'MARRIED', parentBirthDate: '1990-05-10', children: [child('')], today }).hasProblems).toBe(false)
    expect(findChildrenProblems({ maritalStatus: 'MARRIED', parentBirthDate: '', children: [child('2015-01-01')], today }).hasProblems).toBe(false)
  })

  it('rejects a birth date in the future and too many children', () => {
    expect(findChildrenProblems({ maritalStatus: 'MARRIED', parentBirthDate: '1980-01-01', children: [child('2027-01-01')], today }).byRow[0]).toContain('future')
    const many = Array.from({ length: 21 }, () => child('2015-01-01'))
    expect(findChildrenProblems({ maritalStatus: 'MARRIED', parentBirthDate: '1980-01-01', children: many, today }).list).toContain('at most 20')
  })
})

describe('typed numbers in the form', () => {
  const counts = (under_23, age_23_plus, adopted = 0) => ({ under_23: String(under_23), age_23_plus: String(age_23_plus), adopted: String(adopted) })
  const base = { maritalStatus: 'MARRIED', parentBirthDate: '1985-01-01', today: '2026-10-28' }

  it('applies the same rules as the server', () => {
    expect(findCountsProblems({ ...base, counts: counts(2, 1, 0) })).toBeNull()
    expect(findCountsProblems({ ...base, counts: counts(1, 0, 2) })).toContain('Adopted')
    expect(findCountsProblems({ ...base, maritalStatus: 'SINGLE', counts: counts(2, 0, 1) })).toContain('single')
    expect(findCountsProblems({ ...base, parentBirthDate: '1986-01-01', counts: counts(0, 1, 0) })).toContain('at least 41')
    expect(findCountsProblems({ ...base, parentBirthDate: '1986-01-01', counts: counts(0, 1, 1) })).toBeNull()
    expect(findCountsProblems({ ...base, counts: counts(20, 1, 0) })).toContain('at most 20')
  })

  it('reads the response of the server back into the form', () => {
    const value = childrenValueFromResponse({
      mode: 'COUNTS',
      items: [],
      counts: { under_23: 2, age_23_plus: 0, adopted: 1 },
      declared_at: '2026-01-01T00:00:00.000Z',
      needs_review: true,
    })
    expect(value.mode).toBe('COUNTS')
    expect(value.counts).toEqual({ under_23: '2', age_23_plus: '0', adopted: '1' })
    expect(value.needs_review).toBe(true)
    expect(childrenValueFromResponse(undefined)).toEqual(emptyChildrenValue())
  })

  it('sends nothing when nothing changed, the right field when it did, and a clear for none', () => {
    const initial = { ...emptyChildrenValue(), mode: 'COUNTS', counts: counts(1, 0) }
    expect(childrenPayload(initial, { initial })).toEqual({})
    expect(childrenPayload({ ...initial, confirmed: true }, { initial })).toEqual({ children_counts: { under_23: 1, age_23_plus: 0, adopted: 0 } })
    expect(childrenPayload({ ...initial, counts: counts(2, 0) }, { initial })).toEqual({ children_counts: { under_23: 2, age_23_plus: 0, adopted: 0 } })
    const dates = { ...emptyChildrenValue(), mode: 'BIRTH_DATES', rows: [{ birth_date: '2015-01-01', relation: 'BIOLOGICAL' }] }
    expect(childrenPayload(dates, { initial })).toEqual({ children: [{ birth_date: '2015-01-01', relation: 'BIOLOGICAL' }] })
    expect(childrenPayload(emptyChildrenValue(), { initial })).toEqual({ children: [], children_counts: null })
    expect(childrenPayload(emptyChildrenValue(), { isCreate: true })).toEqual({})
    expect(childrenPayload({ ...initial, counts: counts(0, 0) }, { isCreate: true })).toEqual({})
  })

  it('is stale a year after it was confirmed', () => {
    expect(countsAreStale('2025-10-28T00:00:00.000Z', new Date('2026-10-28T00:00:00.000Z'))).toBe(false)
    expect(countsAreStale('2025-10-27T00:00:00.000Z', new Date('2026-10-28T00:00:00.000Z'))).toBe(true)
    expect(countsAreStale(null)).toBe(false)
  })
})

describe('the allowance rule in the form', () => {
  const day = '2026-06-15'
  const rows = (years, relation = 'BIOLOGICAL') => ({ birth_date: `${2026 - years}-01-01`, relation })

  it('stops at the most children that count', () => {
    const five = [rows(1), rows(2), rows(3), rows(4), rows(5)]
    expect(summarizeChildren(five, day).allowance_eligible).toBe(3)
    expect(summarizeChildren(five, day, { ...DEFAULT_ALLOWANCE_RULE, max_children: null }).allowance_eligible).toBe(5)
  })

  it('leaves out the kinds that do not count and the children over the age limit', () => {
    const open = { ...DEFAULT_ALLOWANCE_RULE, max_children: null }
    const mixed = [rows(5), rows(6, 'ADOPTED'), rows(7, 'STEP'), rows(25)]
    expect(summarizeChildren(mixed, day, open).allowance_eligible).toBe(3)
    expect(summarizeChildren(mixed, day, { ...open, count_step: false }).allowance_eligible).toBe(2)
    expect(summarizeChildren(mixed, day, { ...open, age_limit: 6 }).allowance_eligible).toBe(1)
  })

  it('applies the same rule to typed numbers', () => {
    const counts = { under_23: '5', age_23_plus: '1', adopted: '2' }
    expect(summarizeCounts(counts).allowance_eligible).toBe(3)
    expect(summarizeCounts(counts, { ...DEFAULT_ALLOWANCE_RULE, max_children: null, count_adopted: false }).allowance_eligible).toBe(3)
  })
})
