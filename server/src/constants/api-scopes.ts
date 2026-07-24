export const API_SCOPES = {
  EMPLOYEES_READ: "employees:read",
  STUDENTS_READ: "students:read",
  STUDENTS_ACADEMIC_HISTORY_READ: "students:academic_history:read",
  STUDENTS_HEALTH_READ: "students:health:read",
  STUDENTS_CONSENT_READ: "students:consent:read",
} as const;

export type ApiScopeName = (typeof API_SCOPES)[keyof typeof API_SCOPES];
