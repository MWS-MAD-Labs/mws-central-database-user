import { describe, expect, it } from 'bun:test'
import {
  BLOOD_TYPE_VALUE_ALIASES,
  defaultPreviewFields,
  entityLabels,
  FIELD_KEYSTROKE_FILTERS,
  FIELD_VALUE_ALIASES,
  GENDER_VALUE_ALIASES,
  IMPORT_FIELD_LABEL_TO_KEY,
  importFields,
  MONTH_NAME_TO_INDEX,
  OVERRIDE_REASON_TEMPLATES,
  parseDateStringToISO,
  RELIGION_VALUE_ALIASES,
  requiredImportFields,
  STUDENT_STATUS_VALUE_ALIASES,
} from '../../../src/features/import-export/components/importFieldsConfig.js'

describe('importFieldsConfig', () => {
  it('parses supported English, Indonesian, numeric, and ISO date formats', () => {
    expect(parseDateStringToISO('7 September 2012')).toBe('2012-09-07')
    expect(parseDateStringToISO('07 Agustus 2011')).toBe('2011-08-07')
    expect(parseDateStringToISO('9/2/2010')).toBe('2010-02-09')
    expect(parseDateStringToISO('1.3.2008')).toBe('2008-03-01')
    expect(parseDateStringToISO('2009-12-31T00:00:00.000Z')).toBe('2009-12-31')
    expect(parseDateStringToISO('7 NotAMonth 2012')).toBe('')
    expect(parseDateStringToISO('September 7, 2012')).toBe('')
    expect(parseDateStringToISO('')).toBe('')
    expect(MONTH_NAME_TO_INDEX.september).toBe(8)
    expect(MONTH_NAME_TO_INDEX.desember).toBe(11)
  })

  it('defines aliases used to normalize common imported values', () => {
    expect(GENDER_VALUE_ALIASES).toMatchObject({ m: 'MALE', f: 'FEMALE', l: 'MALE', p: 'FEMALE' })
    expect(RELIGION_VALUE_ALIASES['christianity - prosestant']).toBe('PROTESTANTISM')
    expect(RELIGION_VALUE_ALIASES.katolik).toBe('CATHOLICISM')
    expect(STUDENT_STATUS_VALUE_ALIASES['left school']).toBe('WITHDRAWN')
    expect(BLOOD_TYPE_VALUE_ALIASES['ab+']).toBe('AB')
    expect(BLOOD_TYPE_VALUE_ALIASES['-']).toBe('UNKNOWN')
    expect(FIELD_VALUE_ALIASES).toEqual({
      gender: GENDER_VALUE_ALIASES,
      religion: RELIGION_VALUE_ALIASES,
      status: STUDENT_STATUS_VALUE_ALIASES,
      blood_type: BLOOD_TYPE_VALUE_ALIASES,
    })
  })

  it('keeps employee and student required, preview, and editable fields entity-specific', () => {
    expect(entityLabels).toEqual({ students: 'students', employees: 'employees' })
    expect(requiredImportFields.employees).toContain('employee_id')
    expect(requiredImportFields.employees).toContain('employment_type')
    expect(requiredImportFields.employees).not.toContain('current_grade')
    expect(requiredImportFields.students).toContain('current_grade')
    expect(requiredImportFields.students).toContain('entry_type')
    expect(requiredImportFields.students).not.toContain('employee_id')
    expect(defaultPreviewFields.employees).toContain('job_position')
    expect(defaultPreviewFields.students).toContain('father_phone')

    const employeeFields = new Map(importFields.employees.map((field) => [field.key, field]))
    const studentFields = new Map(importFields.students.map((field) => [field.key, field]))
    expect(employeeFields.get('unit')).toMatchObject({ optionSource: 'units' })
    expect(employeeFields.get('birth_date')).toMatchObject({ type: 'date' })
    expect(employeeFields.get('education_level').options).toContain('S1')
    expect(studentFields.get('current_class')).toMatchObject({ optionSource: 'classes' })
    expect(studentFields.get('vaccine_received').options).toEqual(['TRUE', 'FALSE'])
    expect(studentFields.get('override_too_far_ahead_reason')).toMatchObject({
      creatable: true,
      options: OVERRIDE_REASON_TEMPLATES,
    })
    expect(studentFields.has('employee_id')).toBe(false)
  })

  it('exports label mappings and import-safe keystroke filters', () => {
    expect(IMPORT_FIELD_LABEL_TO_KEY['Employee ID']).toBe('employee_id')
    expect(IMPORT_FIELD_LABEL_TO_KEY['Current Grade']).toBe('current_grade')
    expect(FIELD_KEYSTROKE_FILTERS.employee_id('EMP-00123')).toBe('00.12.3')
    expect(FIELD_KEYSTROKE_FILTERS.full_name('ari pratama')).toBe('Ari Pratama')
    expect(FIELD_KEYSTROKE_FILTERS.mobile_phone('+62 (812) 34')).toBe('+6281234')
    expect(FIELD_KEYSTROKE_FILTERS.graduation_year('Class of 20267')).toBe('2026')
  })
})
