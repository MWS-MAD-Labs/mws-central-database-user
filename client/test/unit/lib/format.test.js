import { describe, expect, it, setSystemTime } from 'bun:test'
import {
  adminRoleTone,
  enumOptions,
  formatDate,
  formatDateTime,
  formatEducationLevel,
  formatEnrollmentHistoryCounts,
  formatStatus,
  formatTenure,
  getBirthDateWarning,
  getContractExpiryFlag,
  getDisciplinaryFlagStyle,
  getEmployeeFlagBadges,
  getFarFutureDateWarning,
  getInternFlagBadges,
  getStudentFlagBadges,
  statusTone,
  sumEnrollmentHistoryCounts,
} from '../../../src/lib/format.js'

describe('format helpers', () => {
  it('formats dates and rejects invalid values', () => {
    expect(formatDate('2026-09-17T23:00:00+07:00')).toBe('17 Sept 2026')
    expect(formatDate('')).toBe('-')
    expect(formatDate('invalid')).toBe('-')
    expect(formatDateTime('')).toBe('-')
    expect(formatDateTime('invalid')).toBe('-')
    expect(formatDateTime('2026-09-17T08:30:00.000Z')).toContain('17 Sept 2026')
  })

  it('formats tenure for past and future dates', () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    expect(formatTenure('2025-09-17')).toContain('365 days')
    expect(formatTenure('2026-09-18')).toBe('Starts in 1 day')
    expect(formatTenure('')).toBe('-')
    expect(formatTenure('invalid')).toBe('-')
  })

  it('classifies contract expiry states', () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    expect(getContractExpiryFlag({ status_info: { employment_type: 'PERMANENT' } })).toBeNull()
    expect(getContractExpiryFlag({ status_info: { employment_type: 'CONTRACT', contract_end_date: null } })).toBe('missing')
    expect(getContractExpiryFlag({ status_info: { employment_type: 'CONTRACT', contract_end_date: '2026-09-16' } })).toBe('expired')
    expect(getContractExpiryFlag({ status_info: { employment_type: 'CONTRACT', contract_end_date: '2026-10-01' } })).toBe('soon')
    expect(getContractExpiryFlag({ status_info: { employment_type: 'CONTRACT', contract_end_date: '2027-01-01' } })).toBeNull()
  })

  it('returns date warnings', () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    expect(getBirthDateWarning('2026-09-18')).toBe('This date is in the future.')
    expect(getBirthDateWarning('1800-01-01')).toBe('This date is unusually far in the past.')
    expect(getBirthDateWarning('2000-01-01')).toBeNull()
    expect(getFarFutureDateWarning('2100-01-01')).toBe('This date is unusually far in the future.')
    expect(getFarFutureDateWarning('2030-01-01')).toBeNull()
  })

  it('builds disciplinary flag styles', () => {
    expect(getDisciplinaryFlagStyle(null)).toBeNull()
    expect(getDisciplinaryFlagStyle({ type: 'SURAT_PERINGATAN', level: 2 })).toMatchObject({ label: 'SP2', textClass: 'text-[#991b1b]' })
    expect(getDisciplinaryFlagStyle({ type: 'SURAT_TEGURAN', level: 1 })).toMatchObject({ label: 'ST1', textClass: 'text-[#a16207]' })
  })

  it('builds student warning badges from bounded projections', () => {
    const badges = getStudentFlagBadges({
      identity: { has_birth_date_warning: true },
      academic: {
        import_defaulted_fields: ['religion', 'unknown_key'],
        grade_consistency_override_reason: 'Approved exception',
        has_unresolved_placeholder_class: true,
      },
    })
    expect(badges.map((badge) => badge.key)).toEqual([
      'defaulted',
      'override',
      'placeholder-class',
      'dates',
    ])
    expect(badges[0].title).toContain('Religion, unknown_key')
  })

  it('builds employee and intern warning badges', () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    const employeeBadges = getEmployeeFlagBadges({
      disciplinary_flag: { type: 'SURAT_PERINGATAN', level: 1 },
      identity: { has_birth_date_warning: true },
      employment: { join_date: '2100-01-01' },
      status_info: { employment_type: 'CONTRACT', contract_end_date: null },
    })
    expect(employeeBadges.map((badge) => badge.key)).toEqual([
      'disciplinary',
      'dates',
      'no-contract-end',
    ])

    const internBadges = getInternFlagBadges({
      identity: { has_birth_date_warning: false },
      employment: { join_date: '2030-01-01', end_date: '2100-01-01' },
    })
    expect(internBadges).toHaveLength(1)
    expect(internBadges[0].key).toBe('dates')
  })

  it('formats enrollment history summaries and education levels', () => {
    const counts = { transferred: 2, withdrawn: 1, completed: 3 }
    expect(formatEnrollmentHistoryCounts(counts)).toBe('2 transferred · 1 withdrawn · 3 completed')
    expect(formatEnrollmentHistoryCounts({})).toBeNull()
    expect(sumEnrollmentHistoryCounts(counts)).toBe(6)
    expect(sumEnrollmentHistoryCounts(null)).toBe(0)
    expect(formatEducationLevel('SMA_SMK')).toBe('SMA/SMK')
    expect(formatEducationLevel('CUSTOM')).toBe('CUSTOM')
    expect(formatEducationLevel()).toBe('-')
  })

  it('formats enum labels and tones', () => {
    expect(formatStatus('student_api_id')).toBe('Student API ID')
    expect(formatStatus('')).toBe('-')
    expect(enumOptions(['ACTIVE', 'ON_LEAVE'])).toEqual([
      { value: 'ACTIVE', label: 'Active' },
      { value: 'ON_LEAVE', label: 'On Leave' },
    ])
    expect(statusTone('ACTIVE')).toBe('green')
    expect(statusTone('INACTIVE')).toBe('amber')
    expect(statusTone('ARCHIVED')).toBe('red')
    expect(statusTone('UNKNOWN')).toBe('neutral')
    expect(adminRoleTone('SUPER_ADMIN')).toBe('red')
    expect(adminRoleTone('DATABASE_ADMIN')).toBe('amber')
    expect(adminRoleTone('VIEWER')).toBe('neutral')
  })
})
