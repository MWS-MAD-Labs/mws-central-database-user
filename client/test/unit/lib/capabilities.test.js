import { describe, expect, it } from 'bun:test'
import {
  editBlockedReason,
  canManageEnrollments,
  canManageTeacherAssignments,
  canManageEmployeeDisciplinaryData,
  canViewAcademic,
  canViewStudents,
  canViewWorkforce,
  canViewEmployeeDisciplinaryData,
  canViewEmployeeUnit,
} from '../../../src/lib/capabilities.js'

describe('capabilities', () => {
  it('keeps student and workforce views independent for viewers', () => {
    const user = {
      role: 'VIEWER',
      can_view_student_data: true,
      can_view_employee_data: false,
    }
    expect(canViewStudents(user)).toBe(true)
    expect(canViewWorkforce(user)).toBe(false)
    expect(canViewAcademic(user)).toBe(true)
  })

  it('does not grant task capabilities to viewers', () => {
    const user = {
      role: 'VIEWER',
      can_manage_enrollments: true,
      can_manage_teacher_assignments: true,
    }
    expect(canManageEnrollments(user)).toBe(false)
    expect(canManageTeacherAssignments(user)).toBe(false)
  })

  it('requires employee view plus disciplinary permission for reads', () => {
    expect(canViewEmployeeDisciplinaryData({
      role: 'VIEWER',
      can_view_employee_data: true,
      can_view_employee_disciplinary_data: true,
    })).toBe(true)
    expect(canViewEmployeeDisciplinaryData({
      role: 'VIEWER',
      can_view_employee_data: false,
      can_view_employee_disciplinary_data: true,
    })).toBe(false)
  })

  it('manages only as an in-unit database admin with write and read access', () => {
    const now = new Date('2026-09-25T03:00:00.000Z')
    const employee = { unit_id: 'unit-1' }
    const user = {
      role: 'DATABASE_ADMIN',
      unit_id: 'unit-1',
      can_view_employee_data: true,
      can_view_employee_disciplinary_data: true,
      can_write_employee_data: true,
    }
    expect(canManageEmployeeDisciplinaryData(user, employee, now)).toBe(true)
    expect(canManageEmployeeDisciplinaryData({ ...user, unit_id: 'unit-2' }, employee, now)).toBe(false)
    expect(canManageEmployeeDisciplinaryData({ ...user, can_write_employee_data: false }, employee, now)).toBe(false)
    expect(canManageEmployeeDisciplinaryData({ ...user, role: 'VIEWER' }, employee, now)).toBe(false)
  })

  it('uses the independent employee unit scope for disciplinary access', () => {
    const user = {
      role: 'DATABASE_ADMIN',
      unit_id: 'unit-1',
      employee_view_unit_ids: ['unit-2'],
    }
    expect(canViewEmployeeUnit(user, 'unit-2')).toBe(true)
    expect(canViewEmployeeUnit(user, 'unit-1')).toBe(false)
    expect(canViewEmployeeUnit({ ...user, can_view_all_employee_units: true }, 'unit-3')).toBe(true)
  })
})

describe('editBlockedReason', () => {
  const dbAdmin = { role: 'DATABASE_ADMIN' }
  const weekdayNoon = new Date('2026-09-30T05:00:00.000Z') // Wednesday 12:00 WIB
  const weekdayNight = new Date('2026-09-30T16:00:00.000Z') // Wednesday 23:00 WIB

  it('is silent for roles that never see the explanation', () => {
    expect(editBlockedReason({ role: 'SUPER_ADMIN' }, { hasWriteFlag: false, sameUnit: false }, weekdayNoon)).toBeNull()
    expect(editBlockedReason({ role: 'VIEWER' }, { hasWriteFlag: false, sameUnit: false }, weekdayNoon)).toBeNull()
  })

  it('explains a missing write flag, another unit, and closed office hours', () => {
    expect(editBlockedReason(dbAdmin, { hasWriteFlag: false, sameUnit: true }, weekdayNoon)).toContain('no write access')
    expect(editBlockedReason(dbAdmin, { hasWriteFlag: true, sameUnit: false }, weekdayNoon)).toContain('outside your unit')
    expect(editBlockedReason(dbAdmin, { hasWriteFlag: true, sameUnit: true }, weekdayNight)).toContain('06:30-17:00 WIB')
  })

  it('lets an after-hours grant or office hours through', () => {
    expect(editBlockedReason(dbAdmin, { hasWriteFlag: true, sameUnit: true }, weekdayNoon)).toBeNull()
    const granted = { ...dbAdmin, after_hours_write_until: '2026-10-01T00:00:00.000Z' }
    expect(editBlockedReason(granted, { hasWriteFlag: true, sameUnit: true }, weekdayNight)).toBeNull()
  })
})
