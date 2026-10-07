import { API_SCOPES, type ApiScopeName } from "./api-scopes";

export type CanonicalIntegrationProfile = {
  code: string;
  name: string;
  description: string;
  scopeNames: ApiScopeName[];
};

export const APPLICATION_INTEGRATION_PROFILES = [
  {
    code: "hub",
    name: "MWS Hub",
    description: "Identity and entitlement integration for MWS Hub",
    scopeNames: [
      API_SCOPES.EMPLOYEES_READ,
      API_SCOPES.STUDENTS_READ,
      API_SCOPES.APPLICATION_ENTITLEMENTS_READ,
      API_SCOPES.APPLICATION_PERMISSIONS_WRITE,
    ],
  },
  {
    code: "daily-checkin",
    name: "Daily Check-in",
    description: "Roster and assignment integration for Daily Check-in",
    scopeNames: [
      API_SCOPES.EMPLOYEES_READ,
      API_SCOPES.STUDENTS_READ,
      API_SCOPES.STUDENTS_ROSTER_EXPORT_READ,
      API_SCOPES.CLASS_TEACHER_ASSIGNMENTS_READ,
      API_SCOPES.STUDENT_SUPPORT_ASSIGNMENTS_READ,
      API_SCOPES.APPLICATION_ENTITLEMENTS_READ,
      API_SCOPES.APPLICATION_PERMISSIONS_WRITE,
    ],
  },
  {
    code: "exima",
    name: "Exima",
    description: "Employee and entitlement integration for Exima",
    scopeNames: [
      API_SCOPES.EMPLOYEES_READ,
      API_SCOPES.APPLICATION_ENTITLEMENTS_READ,
      API_SCOPES.APPLICATION_PERMISSIONS_WRITE,
    ],
  },
] as const satisfies readonly CanonicalIntegrationProfile[];
