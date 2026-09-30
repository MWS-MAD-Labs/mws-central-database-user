import { describe, expect, it, mock, setSystemTime } from 'bun:test'
import {
  CONTRACT_DURATION_OPTIONS,
  addMonthsToDateInput,
  capitalizeWords,
  cleanPayload,
  countDigits,
  dateInputFromIso,
  digitsOnly,
  formatBankAccountNumber,
  formatBpjsEmploymentNumber,
  formatBpjsNumber,
  formatDigitGroups,
  formatEmployeeId,
  formatKpjNumber,
  formatNik,
  formatNpwp,
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
  isoFromDateInput,
  isWithinJoinDateFutureCap,
  isWithinReasonableFutureCeiling,
  optionalNumber,
  phoneDigitsOnly,
  scrollToFirstError,
  textLength,
  trimmedOrUndefined,
  yearsBetweenDateInputs,
} from '../../../src/lib/form.js'

describe('form helpers', () => {
  it('converts date values and rejects invalid inputs', () => {
    expect(dateInputFromIso('2026-09-17T12:30:00.000Z')).toBe('2026-09-17')
    expect(dateInputFromIso('invalid')).toBe('')
    expect(dateInputFromIso('')).toBe('')
    expect(isoFromDateInput('2026-09-17')).toBe('2026-09-17T00:00:00.000Z')
    expect(isoFromDateInput('')).toBeUndefined()
  })

  it('cleans, trims, and capitalizes payload values', () => {
    expect(cleanPayload({ empty: '', missing: undefined, zero: 0, no: false, nil: null })).toEqual({ zero: 0, no: false, nil: null })
    expect(trimmedOrUndefined('  Ari  ')).toBe('Ari')
    expect(trimmedOrUndefined('  ')).toBeUndefined()
    expect(trimmedOrUndefined(5)).toBe(5)
    expect(capitalizeWords('ari-nur aini')).toBe('Ari-Nur Aini')
    expect(capitalizeWords(null)).toBeNull()
  })

  it('normalizes phone numbers, digits, and identifiers', () => {
    expect(phoneDigitsOnly('+62 812-abc')).toBe('+62812')
    expect(phoneDigitsOnly('0812-34')).toBe('081234')
    expect(digitsOnly('12a345', 4)).toBe('1234')
    expect(countDigits('12-34')).toBe(4)
    expect(textLength(null)).toBe(0)
    expect(formatEmployeeId('1234567')).toBe('12.34.567')
    expect(formatNik('1234567890123456')).toBe('1234 5678 9012 3456')
    expect(formatNpwp('123456789012345')).toBe('12.345.678.9-012.345')
    expect(formatBankAccountNumber('1234567890')).toBe('1234 5678 90')
    expect(formatBpjsNumber('1234567890123')).toBe('1234 5678 9012 3')
    expect(formatBpjsEmploymentNumber('12345678901')).toBe('1234 5678 901')
    expect(formatKpjNumber('ab-12 3456789012')).toBe('AB123456789')
    expect(formatDigitGroups('12345', [2, 3], ['-'])).toBe('12-345')
  })

  it('parses optional numbers and contract durations', () => {
    expect(optionalNumber('12')).toBe(12)
    expect(optionalNumber('abc')).toBeUndefined()
    expect(optionalNumber('')).toBeUndefined()
    expect(CONTRACT_DURATION_OPTIONS.at(-1)).toEqual({ value: '60', label: '5 Years' })
  })

  it('adds months without UTC date rollover', () => {
    expect(addMonthsToDateInput('2026-01-15', 3)).toBe('2026-04-15')
    expect(addMonthsToDateInput('', 3)).toBe('')
  })

  it('validates birth and future date boundaries', () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    expect(isBirthDateNotFuture('2026-09-17')).toBe(true)
    expect(isBirthDateNotFuture('2026-09-18')).toBe(false)
    expect(isBirthDateNotTooOld('1896-09-17')).toBe(true)
    expect(isBirthDateNotTooOld('1896-09-16')).toBe(false)
    expect(isWithinJoinDateFutureCap('2026-12-16')).toBe(true)
    expect(isWithinJoinDateFutureCap('2026-12-17')).toBe(false)
    expect(isWithinReasonableFutureCeiling('2076-09-17')).toBe(true)
    expect(isWithinReasonableFutureCeiling('2076-09-18')).toBe(false)
    expect(isBirthDateNotFuture('')).toBe(true)
  })

  it('calculates completed years', () => {
    expect(yearsBetweenDateInputs('2000-09-18', '2026-09-17')).toBe(25)
    expect(yearsBetweenDateInputs('2000-09-17', '2026-09-17')).toBe(26)
  })

  it('scrolls to and focuses the first ordered error', () => {
    document.body.innerHTML = `
      <div data-field="email"><input /></div>
      <div data-field="full_name"><input /></div>
    `
    const target = document.querySelector('[data-field="full_name"]')
    const scrollIntoView = mock(() => {})
    target.scrollIntoView = scrollIntoView

    scrollToFirstError(
      { email: 'Invalid', full_name: 'Required' },
      ['full_name', 'email'],
    )

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(document.activeElement).toBe(target.querySelector('input'))
  })
})
