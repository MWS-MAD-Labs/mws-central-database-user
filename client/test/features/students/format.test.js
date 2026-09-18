import { describe, expect, it } from 'bun:test'
import {
  decodeLegacyNisHints,
  formatEntryType,
  getClassName,
  getYearName,
  sortSuggestedFirst,
} from '../../../src/features/students/format.js'

describe('student format helpers', () => {
  it('formats entry types and lookup labels', () => {
    expect(formatEntryType('PSB')).toBe('PSB')
    expect(formatEntryType('PRE_K')).toBe('Pre-K')
    expect(formatEntryType('TRANSFER')).toBe('Transfer')
    expect(getClassName([{ id: 'class-1', name: 'Grade 1A' }], 'class-1')).toBe('Grade 1A')
    expect(getClassName([], 'unknown')).toBe('unknown')
    expect(getClassName([], '')).toBe('-')
    expect(getYearName([{ id: 'year-1', name: '2026/2027' }], 'year-1')).toBe('2026/2027')
  })

  it('moves decoded suggestions first without mutating the source', () => {
    const options = [
      { value: 'PSB', label: 'PSB' },
      { value: 'TRANSFER', label: 'Transfer' },
    ]
    const result = sortSuggestedFirst(options, 'TRANSFER')
    expect(result[0]).toMatchObject({ value: 'TRANSFER', badge: 'Suggested', tone: 'gold' })
    expect(options[1]).not.toHaveProperty('badge')
    expect(sortSuggestedFirst(options, null)).toBe(options)
  })

  it('decodes matching legacy NIS metadata', () => {
    const years = [
      { id: 'year-2025', name: '2025/2026', start_date: '2025-07-01' },
      { id: 'year-2026', name: '2026/2027', start_date: '2026-07-01' },
    ]
    expect(decodeLegacyNisHints('2612006', {
      gradeLevel: 7,
      academicYear: years[1],
      academicYears: years,
    })).toEqual({
      yearDigits: '26',
      unitDigit: '1',
      entryTypeDigit: '2',
      sequenceDigits: '006',
      unitLabel: 'Elementary',
      entryType: 'TRANSFER',
      yearMatches: true,
      unitMatches: false,
      suggestedYear: null,
    })
  })

  it('suggests a unique year for mismatched digits and rejects invalid NIS', () => {
    const years = [
      { id: 'year-2025', name: '2025/2026' },
      { id: 'year-2026', name: '2026/2027' },
    ]
    const result = decodeLegacyNisHints('2511001', {
      gradeLevel: 1,
      academicYear: years[1],
      academicYears: years,
    })
    expect(result.yearMatches).toBe(false)
    expect(result.suggestedYear).toEqual(years[0])
    expect(decodeLegacyNisHints('not-nis', {})).toBeNull()
  })
})
