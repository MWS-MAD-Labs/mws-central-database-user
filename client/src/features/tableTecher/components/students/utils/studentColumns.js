import { formatDate, formatStatus } from '../../../../../lib/format.js'

// Columns mirror StudentResponse from GET /api/admin/students (see
// toStudentResponse in server/src/model/student-model.ts). The list endpoint
// does not return current_class, so there is no Class column here - that
// field only exists on the student detail response.
//
// `editable` follows StudentValidation.UPDATE on the server: only fields that
// schema accepts are editable here. nis and legacy_nis are create-only (nis is
// reissued through its own endpoint), and relation names, enums, and derived
// values stay read-only until the grid has a save path for them.
export const studentColumns = [
  {
    key: 'full_name',
    label: 'Student',
    width: 220,
    sticky: true,
    editable: true,
    value: (student) => student.identity?.full_name,
  },
  {
    key: 'nick_name',
    label: 'Nickname',
    width: 140,
    editable: true,
    value: (student) => student.identity?.nick_name,
  },
  {
    key: 'email',
    label: 'Email',
    width: 240,
    editable: true,
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
    editable: true,
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
    editable: true,
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
