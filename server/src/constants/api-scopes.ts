export const API_SCOPES = {
  EMPLOYEES_READ: "employees:read",
  STUDENTS_READ: "students:read",
  STUDENTS_ACADEMIC_HISTORY_READ: "students:academic_history:read",
  STUDENTS_HEALTH_READ: "students:health:read",
  STUDENTS_CONSENT_READ: "students:consent:read",
  STUDENTS_SUPPORT_CONTACTS_READ: "students:support_contacts:read",
  // Sensitive roster export fields require a dedicated scope.
  STUDENTS_ROSTER_EXPORT_READ: "students:roster_export:read",
  CLASS_TEACHER_ASSIGNMENTS_READ: "class_teacher_assignments:read",
  // SE teacher access is student-scoped, not class-scoped.
  STUDENT_SUPPORT_ASSIGNMENTS_READ: "student_support_assignments:read",
} as const;

export type ApiScopeName = (typeof API_SCOPES)[keyof typeof API_SCOPES];
