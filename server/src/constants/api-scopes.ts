export const API_SCOPES = {
  EMPLOYEES_READ: "employees:read",
} as const;

export type ApiScopeName = (typeof API_SCOPES)[keyof typeof API_SCOPES];
