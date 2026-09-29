export function canViewStudents(user) {
  return user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_student_data);
}

export function canViewWorkforce(user) {
  return user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_employee_data);
}

export function canViewAcademic(user) {
  return canViewStudents(user) || canViewWorkforce(user);
}

export function canViewEmployeeDisciplinaryData(user) {
  return (
    user?.role === "SUPER_ADMIN" ||
    (Boolean(user?.can_view_employee_data) &&
      Boolean(user?.can_view_employee_disciplinary_data))
  );
}

export function canViewEmployeeUnit(user, unitId) {
  if (user?.role === 'SUPER_ADMIN' || user?.can_view_all_employee_units) {
    return true
  }
  const customUnitIds = user?.employee_view_unit_ids || []
  return customUnitIds.length > 0
    ? customUnitIds.includes(unitId)
    : user?.unit_id === unitId
}

function isWithinOfficeHours(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  if (value.weekday === 'Sun') return false
  const minutes = Number(value.hour) * 60 + Number(value.minute)
  return minutes >= 6 * 60 + 30 && minutes <= 17 * 60
}

export function canManageEmployeeDisciplinaryData(user, employee, now = new Date()) {
  if (user?.role === 'SUPER_ADMIN') return true
  if (
    user?.role !== 'DATABASE_ADMIN' ||
    !user?.can_write_employee_data ||
    !canViewEmployeeDisciplinaryData(user) ||
    !employee ||
    !canViewEmployeeUnit(user, employee.unit_id)
  ) {
    return false
  }
  return (
    isWithinOfficeHours(now) ||
    Boolean(
      user.after_hours_write_until &&
        new Date(user.after_hours_write_until).getTime() > now.getTime(),
    )
  )
}

export function canEditStudentProfiles(user) {
  return (
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" && Boolean(user?.can_write_student_data))
  );
}

export function canEditWorkforceProfiles(user) {
  return (
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" && Boolean(user?.can_write_employee_data))
  );
}

export function canManageEnrollments(user) {
  return (
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" && Boolean(user?.can_manage_enrollments))
  );
}

export function canManageTeacherAssignments(user) {
  return (
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" &&
      Boolean(user?.can_manage_teacher_assignments))
  );
}
