import type { AdminUser as PrismaAdminUser, Prisma } from "../generated/prisma/client";
import type { PersonWithEmployee } from "../model/employee-model";

// student_view_units/employee_view_units are loaded once per request by
// adminAuthMiddleware (alongside every other permission flag) - see
// resolveStudentUnitScope/resolveEmployeeUnitScope in admin-permissions.ts.
export type AdminUser = PrismaAdminUser & {
  student_view_units: { unit_id: string }[];
  employee_view_units: { unit_id: string }[];
};

export type AdminVariables = {
  admin: AdminUser;
};

export type EmployeeVariables = {
  employee: PersonWithEmployee;
};

export type DashboardUser =
  | { type: "admin"; admin: AdminUser }
  | { type: "employee"; employee: PersonWithEmployee };

export type DashboardVariables = {
  dashboardUser: DashboardUser;
};

export type ApiClientVariables = {
  clientId: string;
  clientName: string;
  scopes: string[];
};
