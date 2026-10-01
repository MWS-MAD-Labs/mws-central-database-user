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

export function canViewStudentUnit(user, unitId) {
  if (user?.role === 'SUPER_ADMIN' || user?.can_view_all_student_units) {
    return true
  }
  const customUnitIds = user?.student_view_unit_ids || []
  return customUnitIds.length > 0
    ? customUnitIds.includes(unitId)
    : user?.unit_id === unitId
}

// The Employee Units / Student Units setting is the scope for writes too.
// domain: 'employee', 'student', or 'academic' (either one).
export function canWriteInUnit(user, unitId, domain) {
  if (user?.role === 'SUPER_ADMIN') return true
  if (user?.role !== 'DATABASE_ADMIN') return false
  if (domain === 'employee') return canViewEmployeeUnit(user, unitId)
  if (domain === 'student') return canViewStudentUnit(user, unitId)
  return canViewEmployeeUnit(user, unitId) || canViewStudentUnit(user, unitId)
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

// Why a Database Admin cannot edit a record, in words for a tooltip. Null when
// they can (or when the role never edits, so the button just stays hidden).
export function editBlockedReason(user, { hasWriteFlag, sameUnit }, now = new Date()) {
  if (user?.role !== 'DATABASE_ADMIN') return null
  if (!hasWriteFlag) return 'Your account has no write access for this data.'
  if (!sameUnit) {
    return 'This record is outside your allowed units. Ask a Super Admin to widen your unit scope.'
  }
  const hasGrant = Boolean(
    user.after_hours_write_until &&
      new Date(user.after_hours_write_until).getTime() > now.getTime(),
  )
  if (!isWithinOfficeHours(now) && !hasGrant) {
    return 'Writes are only allowed 06:30-17:00 WIB on working days. Ask a Super Admin for an after-hours grant.'
  }
  return null
}

export function canManageEmployeeDisciplinaryData(user, employee, now = new Date()) {
  if (user?.role === 'SUPER_ADMIN') return true
  if (
    user?.role !== 'DATABASE_ADMIN' ||
    !user?.can_write_employee_data ||
    !canViewEmployeeDisciplinaryData(user) ||
    !employee ||
    !canWriteInUnit(user, employee.unit_id, 'employee')
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
