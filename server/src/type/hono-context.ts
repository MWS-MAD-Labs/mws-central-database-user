import type { AdminUser, Prisma } from "../generated/prisma/client";
import type { PersonWithEmployee } from "../model/employee-model";

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
