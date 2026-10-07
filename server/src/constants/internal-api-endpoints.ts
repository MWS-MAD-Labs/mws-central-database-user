import { API_SCOPES } from "./api-scopes";

export type InternalApiEndpointDoc = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  scope: string;
  // Plain-language name and grouping for the admin-facing reference.
  title: string;
  group: "Students" | "Employees" | "Classes and teachers" | "Application access";
  purpose: string;
};

// Source for the Access page's internal API reference.
export const INTERNAL_API_ENDPOINTS: InternalApiEndpointDoc[] = [
  {
    method: "GET",
    path: "/api/internal/students",
    scope: API_SCOPES.STUDENTS_READ,
    title: "List students",
    group: "Students",
    purpose: "Gets the list of students so another app can show or sync them.",
  },
  {
    method: "GET",
    path: "/api/internal/students/lookup?email=student@millennia21.id",
    scope: API_SCOPES.STUDENTS_READ,
    title: "Find one student",
    group: "Students",
    purpose: "Finds a single student by NIS or email.",
  },
  {
    method: "GET",
    path: "/api/internal/students/{student_id}/academic-history",
    scope: API_SCOPES.STUDENTS_ACADEMIC_HISTORY_READ,
    title: "Student class and grade history",
    group: "Students",
    purpose: "Shows which classes and grades a student was in over time.",
  },
  {
    method: "GET",
    path: "/api/internal/students/{student_id}/consent-status",
    scope: API_SCOPES.STUDENTS_CONSENT_READ,
    title: "Student consent status",
    group: "Students",
    purpose: "Tells another app whether a student's consents are in place.",
  },
  {
    method: "GET",
    path: "/api/internal/students/{student_id}/health",
    scope: API_SCOPES.STUDENTS_HEALTH_READ,
    title: "Student health information",
    group: "Students",
    purpose: "Gives a student's health information and special needs.",
  },
  {
    method: "GET",
    path: "/api/internal/employees",
    scope: API_SCOPES.EMPLOYEES_READ,
    title: "List employees",
    group: "Employees",
    purpose: "Gets the list of employees so another app can show or sync them.",
  },
  {
    method: "GET",
    path: "/api/internal/employees/lookup?email=employee@millennia21.id",
    scope: API_SCOPES.EMPLOYEES_READ,
    title: "Find one employee",
    group: "Employees",
    purpose: "Finds a single employee by employee ID or email.",
  },
  {
    method: "GET",
    path: "/api/internal/students/{student_id}/support-contacts",
    scope: API_SCOPES.STUDENTS_SUPPORT_CONTACTS_READ,
    title: "A student's class teachers",
    group: "Students",
    purpose: "Gives the homeroom and subject teachers of a student's current class.",
  },
  {
    method: "GET",
    path: "/api/internal/students/roster-export",
    scope: API_SCOPES.STUDENTS_ROSTER_EXPORT_READ,
    title: "Full student roster",
    group: "Students",
    purpose: "Gives one flat list of every student, used by the report card Google Sheet sync.",
  },
  {
    method: "GET",
    path: "/api/internal/class-teacher-assignments",
    scope: API_SCOPES.CLASS_TEACHER_ASSIGNMENTS_READ,
    title: "Classes a teacher is assigned to",
    group: "Classes and teachers",
    purpose: "Shows which classes a teacher is currently assigned to, as homeroom or subject teacher.",
  },
  {
    method: "GET",
    path: "/api/internal/student-support-assignments",
    scope: API_SCOPES.STUDENT_SUPPORT_ASSIGNMENTS_READ,
    title: "Students a support teacher looks after",
    group: "Classes and teachers",
    purpose: "Shows which students a special education or support teacher is currently responsible for.",
  },
  {
    method: "GET",
    path: "/api/internal/application-entitlements/lookup?person_id={person_id}&application_id=exima",
    scope: API_SCOPES.APPLICATION_ENTITLEMENTS_READ,
    title: "Who may use an application",
    group: "Application access",
    purpose: "Checks whether a person currently has access to an MWS application.",
  },
  {
    method: "PUT",
    path: "/api/internal/application-permissions/exima",
    scope: API_SCOPES.APPLICATION_PERMISSIONS_WRITE,
    title: "Publish application permissions",
    group: "Application access",
    purpose: "An application sends the permissions its code understands, so roles can only use those.",
  },
  {
    method: "GET",
    path: "/api/internal/application-permissions/exima",
    scope: API_SCOPES.APPLICATION_ENTITLEMENTS_READ,
    title: "Registered application permissions",
    group: "Application access",
    purpose: "Lists the permissions registered for an application, to check them against its code.",
  },
  {
    method: "GET",
    path: "/api/internal/application-permissions/exima/usage",
    scope: API_SCOPES.APPLICATION_ENTITLEMENTS_READ,
    title: "Permissions roles carry",
    group: "Application access",
    purpose: "Lists the permissions active roles of an application carry, to compare with the application's code.",
  },
];
