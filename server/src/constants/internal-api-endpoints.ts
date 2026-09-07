import { API_SCOPES } from "./api-scopes";

export type InternalApiEndpointDoc = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  scope: string;
  purpose: string;
};

// Single source of truth for the Access page's "Internal API reference"
// table - the frontend fetches this instead of hardcoding its own copy of
// the endpoint list, so adding a new /api/internal/* route only means
// updating this one array (plus whatever new scope constant/router it
// actually needs), not remembering a second place to document it too.
export const INTERNAL_API_ENDPOINTS: InternalApiEndpointDoc[] = [
  {
    method: "GET",
    path: "/api/internal/students",
    scope: API_SCOPES.STUDENTS_READ,
    purpose: "List students for internal apps.",
  },
  {
    method: "GET",
    path: "/api/internal/students/lookup?email=student@millennia21.id",
    scope: API_SCOPES.STUDENTS_READ,
    purpose: "Lookup one student by NIS or email.",
  },
  {
    method: "GET",
    path: "/api/internal/students/{student_id}/academic-history",
    scope: API_SCOPES.STUDENTS_ACADEMIC_HISTORY_READ,
    purpose: "Read student class and grade history.",
  },
  {
    method: "GET",
    path: "/api/internal/students/{student_id}/consent-status",
    scope: API_SCOPES.STUDENTS_CONSENT_READ,
    purpose: "Read consent status for downstream checks.",
  },
  {
    method: "GET",
    path: "/api/internal/students/{student_id}/health",
    scope: API_SCOPES.STUDENTS_HEALTH_READ,
    purpose: "Read health and special-needs data.",
  },
  {
    method: "GET",
    path: "/api/internal/employees",
    scope: API_SCOPES.EMPLOYEES_READ,
    purpose: "List employees for internal apps.",
  },
  {
    method: "GET",
    path: "/api/internal/employees/lookup?email=employee@millennia21.id",
    scope: API_SCOPES.EMPLOYEES_READ,
    purpose: "Lookup one employee by ID or email.",
  },
  {
    method: "GET",
    path: "/api/internal/students/{student_id}/support-contacts",
    scope: API_SCOPES.STUDENTS_SUPPORT_CONTACTS_READ,
    purpose: "Read student support contacts data.",
  },
  {
    method: "GET",
    path: "/api/internal/students/roster-export",
    scope: API_SCOPES.STUDENTS_ROSTER_EXPORT_READ,
    purpose: "Flat per-student roster pull for the report-card Google Sheet sync.",
  },
  {
    method: "GET",
    path: "/api/internal/class-teacher-assignments",
    scope: API_SCOPES.CLASS_TEACHER_ASSIGNMENTS_READ,
    purpose: "Which classes a teacher's account is currently assigned to (homeroom/subject).",
  },
  {
    method: "GET",
    path: "/api/internal/student-support-assignments",
    scope: API_SCOPES.STUDENT_SUPPORT_ASSIGNMENTS_READ,
    purpose: "Which students an employee is the active SE/support teacher for.",
  },
];
