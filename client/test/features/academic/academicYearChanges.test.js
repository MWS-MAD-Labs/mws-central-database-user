import { describe, expect, it } from 'bun:test'
import { hasAcademicYearChanges } from '../../../src/features/academic/utils/academicYearChanges.js'

const initial = { startYear: '2026', start_date: '2026-07-01', end_date: '2027-06-30', status: 'ACTIVE', activateClasses: false }
const saved = [
  { id: 's1', name: 'Semester 1', start_date: '2026-07-01', end_date: '2026-12-30', half_end_date: '2026-09-30' },
  { id: 's2', name: 'Semester 2', start_date: '2026-12-31', end_date: '2027-06-30', half_end_date: '2027-03-31' },
]

const check = ({ values = {}, semesters = saved, savedSemesters = saved } = {}) =>
  hasAcademicYearChanges({ initial, values: { ...initial, ...values }, semesters, savedSemesters })

describe('hasAcademicYearChanges', () => {
  it('is false when nothing differs from what is stored', () => {
    expect(check()).toBe(false)
  })

  it.each([
    ['the start year', { startYear: '2027' }],
    ['the start date', { start_date: '2026-07-02' }],
    ['the end date', { end_date: '2027-07-01' }],
    ['the status', { status: 'COMPLETED' }],
    ['activating classes', { activateClasses: true }],
  ])('is true when %s changes', (_, values) => {
    expect(check({ values })).toBe(true)
  })

  it('is true for the default semesters of a year that has none stored', () => {
    const defaults = [{ name: 'Semester 1', start_date: '2026-07-01', end_date: '2026-12-30', half_end_date: '2026-09-30' }]
    expect(check({ semesters: defaults, savedSemesters: [] })).toBe(true)
  })

  it('is false for a year with no semesters at all', () => {
    expect(check({ semesters: [], savedSemesters: [] })).toBe(false)
  })

  it.each(['start_date', 'end_date', 'half_end_date'])('is true when a stored semester %s changes', (field) => {
    const edited = [{ ...saved[0], [field]: '2026-08-15' }, saved[1]]
    expect(check({ semesters: edited })).toBe(true)
  })

  it('is false again once a semester is put back', () => {
    const edited = [{ ...saved[0], half_end_date: '2026-09-30' }, saved[1]]
    expect(check({ semesters: edited })).toBe(false)
  })

  it('treats a missing mid semester date like an empty one', () => {
    const stored = [{ ...saved[0], half_end_date: null }]
    expect(check({ semesters: [{ ...stored[0], half_end_date: '' }], savedSemesters: stored })).toBe(false)
  })
})
