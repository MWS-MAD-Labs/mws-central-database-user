import { describe, expect, it } from 'bun:test'
import {
  ageOn,
  describeChildren,
  findChildrenProblems,
  summarizeChildren,
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
    expect(summary).toEqual({ total: 3, under_23: 2, age_23_plus: 1 })
  })

  it('says it in words', () => {
    expect(describeChildren({ total: 0, under_23: 0, age_23_plus: 0 })).toBe('No children')
    expect(describeChildren({ total: 1, under_23: 1, age_23_plus: 0 })).toBe('1 child: 1 under 23, 0 aged 23 or over')
    expect(describeChildren({ total: 3, under_23: 2, age_23_plus: 1 })).toBe('3 children: 2 under 23, 1 aged 23 or over')
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
