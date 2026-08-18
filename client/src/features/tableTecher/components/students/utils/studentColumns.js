import { formatDate, formatStatus } from '../../../../../lib/format.js'

// Columns mirror StudentResponse from GET /api/admin/students (see
// toStudentResponse in server/src/model/student-model.ts). The list endpoint
// does not return current_class, so there is no Class column here - that
// field only exists on the student detail response.
//
// Read-only for now. `cellType` drives how WorkspaceGrid renders a cell, so
// student-specific behaviour stays out of the grid itself.
export const studentColumns = [
  {
    key: 'full_name',
    label: 'Student',
    width: 220,
    sticky: true,
    cellType: 'link',
    getHref: (student) => `/students/${student.id}`,
    value: (student) => student.identity?.full_name,
  },
  {
    key: 'nick_name',
    label: 'Nickname',
    width: 140,
    value: (student) => student.identity?.nick_name,
  },
  {
    key: 'email',
    label: 'Email',
    width: 240,
    value: (student) => student.identity?.email,
  },
  {
    key: 'gender',
    label: 'Gender',
    width: 110,
    value: (student) => formatStatus(student.identity?.gender),
  },
  {
    key: 'religion',
    label: 'Religion',
    width: 150,
    value: (student) => formatStatus(student.identity?.religion),
  },
  {
    key: 'nis',
    label: 'NIS',
    width: 130,
    numeric: true,
    value: (student) => student.academic?.nis,
  },
  {
    key: 'legacy_nis',
    label: 'Legacy NIS',
    width: 130,
    numeric: true,
    value: (student) => student.academic?.legacy_nis,
  },
  {
    key: 'nisn',
    label: 'NISN',
    width: 140,
    numeric: true,
    value: (student) => student.academic?.nisn,
  },
  {
    key: 'current_grade',
    label: 'Grade',
    width: 120,
    value: (student) => student.academic?.current_grade,
  },
  {
    key: 'join_grade',
    label: 'Join Grade',
    width: 130,
    value: (student) => student.academic?.join_grade,
  },
  {
    key: 'join_year',
    label: 'Join Year',
    width: 140,
    value: (student, lookup) =>
      lookup?.academicYearsById?.[student.academic?.join_academic_year_id],
  },
  {
    key: 'previous_school',
    label: 'Previous School',
    width: 200,
    value: (student) => student.academic?.previous_school,
  },
  {
    key: 'status',
    label: 'Status',
    width: 140,
    type: 'status',
    value: (student) => student.status,
  },
  {
    key: 'created_at',
    label: 'Created',
    width: 140,
    value: (student) => formatDate(student.created_at),
  },
]
