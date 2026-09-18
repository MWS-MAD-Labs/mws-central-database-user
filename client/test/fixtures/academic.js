export const academicYears = [
  {
    id: 'year-2026',
    name: '2026/2027',
    start_date: '2026-07-01T00:00:00.000Z',
    end_date: '2027-06-30T00:00:00.000Z',
    status: 'ACTIVE',
  },
  {
    id: 'year-2027',
    name: '2027/2028',
    start_date: '2027-07-01T00:00:00.000Z',
    end_date: '2028-06-30T00:00:00.000Z',
    status: 'UPCOMING',
  },
]

export const grades = [
  { id: 'grade-1', name: 'Grade 1', level: 1, unit_id: 'unit-elementary', unit_name: 'Elementary' },
  { id: 'grade-2', name: 'Grade 2', level: 2, unit_id: 'unit-elementary', unit_name: 'Elementary' },
]

export function classFixture(overrides = {}) {
  const base = {
    id: 'class-1',
    name: 'Grade 1A',
    status: 'ACTIVE',
    capacity: 30,
    grade: grades[0],
    additional_grades: [],
    academic_year: academicYears[0],
    active_enrollment_count: 1,
    enrollment_history_counts: { completed: 1, transferred: 0, withdrawn: 0 },
    homeroom_teachers: [],
    supporting_homeroom_teachers: [],
    subject_teachers: [],
    has_dependents: false,
  }
  return { ...base, ...overrides }
}

export function enrollmentFixture(overrides = {}) {
  const base = {
    id: 'enrollment-1',
    enrollment_status: 'ACTIVE',
    start_date: '2026-07-01T00:00:00.000Z',
    end_date: null,
    grade_level: 'Grade 1',
    is_retention: false,
    retention_reason: null,
    student: {
      id: 'student-1',
      full_name: 'Ari Student',
      nis: '2611001',
      status: 'ACTIVE',
      has_unresolved_placeholder_class: false,
    },
    class: { id: 'class-1', name: 'Grade 1A' },
    academic_year: academicYears[0],
  }
  return { ...base, ...overrides }
}

export const studentCandidate = {
  id: 'student-2',
  status: 'ACTIVE',
  identity: { full_name: 'Bela Student' },
  academic: {
    nis: '2611002',
    current_grade: 'Grade 1',
    current_class_id: null,
  },
}

export const teachingEmployees = [
  {
    id: 'employee-home',
    identity: { full_name: 'Hana Homeroom' },
    employment: { job_level: 'Teacher', job_position: 'Homeroom Teacher', unit: 'Elementary' },
  },
  {
    id: 'employee-science',
    identity: { full_name: 'Sari Science' },
    employment: { job_level: 'Teacher', job_position: 'Science Teacher', unit: 'Elementary' },
  },
]

export const superAdminUser = {
  id: 'admin-1',
  type: 'admin',
  role: 'SUPER_ADMIN',
  unit_id: null,
  can_write_student_data: true,
  can_write_employee_data: true,
}

export const viewerUser = {
  id: 'viewer-1',
  type: 'admin',
  role: 'VIEWER',
  unit_id: null,
}

export const paging = {
  current_page: 1,
  total_page: 1,
  total_item: 1,
  size: 10,
}
