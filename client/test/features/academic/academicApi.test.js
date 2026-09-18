import { describe, expect, it, mock } from 'bun:test'
import {
  academicYearsApi,
  academicYearStatuses,
  classesApi,
  classStatuses,
  classTeacherRoles,
  enrollmentsApi,
  enrollmentCloseStatuses,
  enrollmentStatuses,
  gradesApi,
} from '../../../src/features/academic/api/academicApi.js'

function response(data = { ok: true }) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function calls(fetchMock) {
  return fetchMock.mock.calls.map(([url, options]) => [url, options.method || 'GET'])
}

describe('academicApi', () => {
  it('exports the academic option catalogs', () => {
    expect(academicYearStatuses).toEqual(['UPCOMING', 'ACTIVE', 'COMPLETED'])
    expect(classStatuses).toEqual(['ACTIVE', 'INACTIVE', 'UPCOMING'])
    expect(classTeacherRoles).toEqual(['HOMEROOM', 'SUPPORTING_HOMEROOM', 'SUBJECT_TEACHER'])
    expect(enrollmentStatuses).toEqual(['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'WITHDRAWN'])
    expect(enrollmentCloseStatuses).toEqual(['COMPLETED', 'TRANSFERRED', 'WITHDRAWN'])
  })

  it('maps academic year, grade, and class CRUD plus class teacher endpoints', async () => {
    const fetchMock = mock(async () => response())
    globalThis.fetch = fetchMock

    await academicYearsApi.list({ page: 2, status: 'ACTIVE', empty: '' })
    await academicYearsApi.get('year-1')
    await academicYearsApi.create({ name: '2027/2028' })
    await academicYearsApi.update('year-1', { status: 'COMPLETED' })
    await academicYearsApi.remove('year-1')
    await academicYearsApi.getUnresolvedEnrollmentCount('year-1')
    await academicYearsApi.bulkCreate({ start_year: 2027, count: 2 })
    await academicYearsApi.getOutOfRangeEnrollmentCount('year-1', { start_date: '2026-07-01', end_date: '' })
    await gradesApi.list({ page: 1, size: 100 })
    await gradesApi.create({ name: 'Grade 3' })
    await classesApi.get('class-1')
    await classesApi.update('class-1', { capacity: 32 })
    await classesApi.remove('class-1')
    await classesApi.teacherAssignments('class-1')
    await classesApi.assignTeacher('class-1', { employee_id: 'employee-1', role: 'HOMEROOM' })
    await classesApi.endTeacherAssignment('class-1', 'assignment-1', '2026-09-17T00:00:00.000Z')
    await classesApi.endTeacherAssignment('class-1', 'assignment-2')
    await classesApi.removeTeacherAssignment('class-1', 'assignment-1')
    await classesApi.reopenTeacherAssignment('class-1', 'assignment-1')
    await classesApi.bulkMoveTeacherAssignments('class-1', { assignment_ids: ['assignment-1'], target_class_id: 'class-2' })

    expect(calls(fetchMock)).toEqual([
      ['/api/admin/academic-years?page=2&status=ACTIVE', 'GET'],
      ['/api/admin/academic-years/year-1', 'GET'],
      ['/api/admin/academic-years', 'POST'],
      ['/api/admin/academic-years/year-1', 'PATCH'],
      ['/api/admin/academic-years/year-1', 'DELETE'],
      ['/api/admin/academic-years/year-1/unresolved-enrollments', 'GET'],
      ['/api/admin/academic-years/bulk', 'POST'],
      ['/api/admin/academic-years/year-1/out-of-range-enrollments?start_date=2026-07-01', 'GET'],
      ['/api/admin/grades?page=1&size=100', 'GET'],
      ['/api/admin/grades', 'POST'],
      ['/api/admin/classes/class-1', 'GET'],
      ['/api/admin/classes/class-1', 'PATCH'],
      ['/api/admin/classes/class-1', 'DELETE'],
      ['/api/admin/classes/class-1/teacher-assignments', 'GET'],
      ['/api/admin/classes/class-1/teachers', 'POST'],
      ['/api/admin/classes/class-1/teachers/assignment-1/end', 'PATCH'],
      ['/api/admin/classes/class-1/teachers/assignment-2/end', 'PATCH'],
      ['/api/admin/classes/class-1/teachers/assignment-1', 'DELETE'],
      ['/api/admin/classes/class-1/teachers/assignment-1/reopen', 'PATCH'],
      ['/api/admin/classes/class-1/teachers/bulk/move', 'PATCH'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[15][1].body)).toEqual({ end_date: '2026-09-17T00:00:00.000Z' })
    expect(JSON.parse(fetchMock.mock.calls[16][1].body)).toEqual({})
    expect(JSON.parse(fetchMock.mock.calls[19][1].body)).toEqual({
      assignment_ids: ['assignment-1'],
      target_class_id: 'class-2',
    })
  })

  it('maps every enrollment lifecycle and bulk endpoint with payloads', async () => {
    const fetchMock = mock(async () => response())
    globalThis.fetch = fetchMock
    const payload = { class_id: 'class-2', effective_date: '2027-07-01T00:00:00.000Z' }

    await enrollmentsApi.list({ page: 1, class_id: 'class-1', is_deleted: false, empty: '' })
    await enrollmentsApi.history('student-1', { include_deleted: true })
    await enrollmentsApi.create('student-1', payload)
    await enrollmentsApi.bulkCreate({ student_ids: ['student-1'], ...payload })
    await enrollmentsApi.previewBackfill({ student_ids: ['student-1'], class_id: 'class-2' })
    await enrollmentsApi.promote('student-1', 'enrollment-1', payload)
    await enrollmentsApi.bulkPromote({ enrollment_ids: ['enrollment-1'], ...payload })
    await enrollmentsApi.transfer('student-1', 'enrollment-1', payload)
    await enrollmentsApi.close('student-1', 'enrollment-1', { status: 'WITHDRAWN' })
    await enrollmentsApi.fixClass('student-1', 'enrollment-1', { class_id: 'class-1' })
    await enrollmentsApi.bulkTransfer({ enrollment_ids: ['enrollment-1'], class_id: 'class-2' })
    await enrollmentsApi.bulkClose({ enrollment_ids: ['enrollment-1'], status: 'COMPLETED' })
    await enrollmentsApi.reactivate('student-1', 'enrollment-1', { start_date: '2026-07-01' })
    await enrollmentsApi.bulkReactivate({ enrollment_ids: ['enrollment-1'] })
    await enrollmentsApi.remove('student-1', 'enrollment-1', { reason: 'duplicate' })
    await enrollmentsApi.bulkRemove({ enrollment_ids: ['enrollment-1'] })
    await enrollmentsApi.restore('student-1', 'enrollment-1')

    expect(calls(fetchMock)).toEqual([
      ['/api/admin/enrollments?page=1&class_id=class-1&is_deleted=false', 'GET'],
      ['/api/admin/students/student-1/enrollments?include_deleted=true', 'GET'],
      ['/api/admin/students/student-1/enrollments', 'POST'],
      ['/api/admin/enrollments/bulk', 'POST'],
      ['/api/admin/enrollments/preview-backfill', 'POST'],
      ['/api/admin/students/student-1/enrollments/enrollment-1/promote', 'PATCH'],
      ['/api/admin/enrollments/bulk/promote', 'PATCH'],
      ['/api/admin/students/student-1/enrollments/enrollment-1/transfer', 'PATCH'],
      ['/api/admin/students/student-1/enrollments/enrollment-1/close', 'PATCH'],
      ['/api/admin/students/student-1/enrollments/enrollment-1/fix-class', 'PATCH'],
      ['/api/admin/enrollments/bulk/transfer', 'PATCH'],
      ['/api/admin/enrollments/bulk/close', 'PATCH'],
      ['/api/admin/students/student-1/enrollments/enrollment-1/reactivate', 'PATCH'],
      ['/api/admin/enrollments/bulk/reactivate', 'PATCH'],
      ['/api/admin/students/student-1/enrollments/delete/enrollment-1', 'PATCH'],
      ['/api/admin/enrollments/bulk/delete', 'PATCH'],
      ['/api/admin/students/student-1/enrollments/restore/enrollment-1', 'PATCH'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(payload)
    expect(JSON.parse(fetchMock.mock.calls[14][1].body)).toEqual({ reason: 'duplicate' })
  })
})
