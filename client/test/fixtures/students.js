export const studentFormOptions = {
  grades: [
    { id: 'grade-1', name: 'Grade 1', level: 1, unit_id: 'unit-elementary' },
    { id: 'grade-2', name: 'Grade 2', level: 2, unit_id: 'unit-elementary' },
    { id: 'grade-7', name: 'Grade 7', level: 7, unit_id: 'unit-junior-high' },
    { id: 'grade-legacy', name: 'Unknown (Legacy Import)', level: 0, unit_id: 'unit-elementary' },
  ],
  academicYears: [
    { id: 'year-2025', name: '2025/2026', status: 'COMPLETED' },
    { id: 'year-2026', name: '2026/2027', status: 'ACTIVE' },
  ],
  classes: [],
}

export function studentFixture(overrides = {}) {
  const base = {
    id: 'student-1',
    created_at: '2026-09-17T08:00:00.000Z',
    status: 'ACTIVE',
    identity: {
      full_name: 'Ari Student',
      nick_name: 'Ari',
      email: 'ari.student@millennia21.id',
      gender: 'MALE',
      religion: 'ISLAM',
      religion_other: null,
      birth_place: 'Jakarta',
      birth_date: '2018-05-10T00:00:00.000Z',
    },
    academic: {
      nis: '2611001',
      legacy_nis: null,
      nisn: '1234567890',
      entry_type: 'PSB',
      current_grade: 'Grade 1',
      current_class: null,
      join_academic_year_id: 'year-2025',
      join_grade: 'Grade 1',
      previous_school: 'Previous School',
      graduation_grade: null,
      leave_year: null,
      sn: false,
      pickup_drop_service: true,
      catering_service: false,
      psb_guide: true,
      has_completed_enrollment: false,
      has_active_enrollment_history: false,
    },
  }

  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...overrides.identity },
    academic: { ...base.academic, ...overrides.academic },
  }
}

export const superAdminUser = {
  id: 'admin-1',
  type: 'admin',
  role: 'SUPER_ADMIN',
  unit_id: null,
}

export const elementaryDatabaseAdmin = {
  id: 'admin-2',
  type: 'admin',
  role: 'DATABASE_ADMIN',
  unit_id: 'unit-elementary',
}

export function studentListItem(overrides = {}) {
  const base = {
    id: 'student-1',
    status: 'ACTIVE',
    identity: {
      full_name: 'Ari Student',
      email: 'ari.student@millennia21.id',
      has_birth_date_warning: false,
    },
    academic: {
      nis: '2611001',
      nisn: '1234567890',
      current_grade: 'Grade 1',
      current_class: 'Grade 1A',
      current_class_id: 'class-1',
      join_academic_year_id: 'year-2025',
      import_defaulted_fields: [],
      grade_consistency_override_reason: null,
      has_unresolved_placeholder_class: false,
      has_class_history: true,
    },
  }
  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...overrides.identity },
    academic: { ...base.academic, ...overrides.academic },
  }
}
