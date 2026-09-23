export function canViewStudents(user) {
  return user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_student_data);
}

export function canViewWorkforce(user) {
  return user?.role === "SUPER_ADMIN" || Boolean(user?.can_view_employee_data);
}

export function canViewAcademic(user) {
  return canViewStudents(user) || canViewWorkforce(user);
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
