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
  can_write_employee_data: true,
  can_view_employee_pii: true,
  can_view_employee_data: true,
  can_view_employee_disciplinary_data: true,
  after_hours_write_until: '2099-01-01T00:00:00.000Z',
}

export const employeeSuperAdmin = superAdminUser
export const employeeDatabaseAdmin = {
  ...elementaryDatabaseAdmin,
  can_view_employee_pii: false,
}

export const employeeFormOptions = {
  units: [
    { id: 'unit-elementary', name: 'Elementary' },
    { id: 'unit-secondary', name: 'Secondary' },
  ],
  jobLevels: [
    {
      id: 'level-staff',
      name: 'Staff',
      is_teaching_role: false,
      units: [{ id: 'unit-elementary', name: 'Elementary' }],
    },
    {
      id: 'level-teacher',
      name: 'Teacher',
      is_teaching_role: true,
      units: [{ id: 'unit-elementary', name: 'Elementary' }],
    },
  ],
  jobPositions: [
    {
      id: 'position-admin',
      name: 'Administrator',
      is_teaching_position: false,
      units: [{ id: 'unit-elementary', name: 'Elementary' }],
    },
    {
      id: 'position-teacher',
      name: 'Classroom Teacher',
      is_teaching_position: true,
      units: [{ id: 'unit-elementary', name: 'Elementary' }],
    },
  ],
  buildings: [{ id: 'building-main', name: 'Main Building' }],
}

export function employeeFixture(overrides = {}) {
  const base = {
    id: 'employee-1',
    created_at: '2026-01-10T08:00:00.000Z',
    identity: {
      full_name: 'Ari Employee',
      nick_name: 'Ari',
      email: 'ari.employee@millennia21.id',
      mobile_phone: '081234567890',
      residential_address: 'Jakarta',
      photo_url: 'https://example.test/employee.jpg',
      gender: 'MALE',
      religion: 'ISLAM',
      religion_other: null,
      birth_place: 'Jakarta',
      birth_date: '1990-05-10T00:00:00.000Z',
      marital_status: 'SINGLE',
      nik: '3174010101900001',
      nik_set_at: '2026-01-10T08:00:00.000Z',
      npwp: null,
      bank_account_number: null,
      bpjs_number: null,
      bpjs_employment_number: null,
      kpj_number: null,
      education_level: 'S1',
      institution_name: 'Example University',
      major: 'Education',
      graduation_year: 2012,
      is_self: false,
    },
    employment: {
      employee_id: '12.34.567',
      unit: 'Elementary',
      job_position: 'Administrator',
      job_level: 'Staff',
      building: 'Main Building',
      join_date: '2020-07-01T00:00:00.000Z',
      is_teaching_role: false,
    },
    status_info: {
      status: 'ACTIVE',
      employment_type: 'CONTRACT',
      contract_end_date: '2027-07-01T00:00:00.000Z',
      last_working_date: null,
    },
    offboarding: { last_working_date: null, notes: null },
  }

  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...overrides.identity },
    employment: { ...base.employment, ...overrides.employment },
    status_info: { ...base.status_info, ...overrides.status_info },
    offboarding: { ...base.offboarding, ...overrides.offboarding },
  }
}

export function employeeListItem(overrides = {}) {
  const employee = employeeFixture(overrides)
  return {
    id: employee.id,
    identity: employee.identity,
    employment: employee.employment,
    status_info: employee.status_info,
  }
}
