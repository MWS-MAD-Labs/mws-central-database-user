import { describe, expect, it } from 'bun:test'
import {
  canManageEnrollments,
  canManageTeacherAssignments,
  canViewAcademic,
  canViewStudents,
  canViewWorkforce,
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
})
