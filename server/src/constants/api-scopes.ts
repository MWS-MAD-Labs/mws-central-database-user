export const API_SCOPES = {
  EMPLOYEES_READ: "employees:read",
  STUDENTS_READ: "students:read",
  STUDENTS_ACADEMIC_HISTORY_READ: "students:academic_history:read",
  STUDENTS_HEALTH_READ: "students:health:read",
  STUDENTS_CONSENT_READ: "students:consent:read",
  STUDENTS_SUPPORT_CONTACTS_READ: "students:support_contacts:read",
  // Bundles health/parent-contact fields into every row - kept separate
  // from STUDENTS_READ so granting it is a deliberate decision, not
  // something a roster-sync-only client (e.g. Daily Check-in) gets by
  // default.
  STUDENTS_ROSTER_EXPORT_READ: "students:roster_export:read",
  CLASS_TEACHER_ASSIGNMENTS_READ: "class_teacher_assignments:read",
  // Separate from CLASS_TEACHER_ASSIGNMENTS_READ - an SE teacher's
  // relationship to a student is per-student (StudentSupportAssignment),
  // not per-class, so a consumer needs this to scope an SE teacher's own
  // roster instead of trying to force them through the class-based path.
  STUDENT_SUPPORT_ASSIGNMENTS_READ: "student_support_assignments:read",
} as const;

export type ApiScopeName = (typeof API_SCOPES)[keyof typeof API_SCOPES];
