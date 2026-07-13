import type { AdminUser, Prisma } from "../generated/prisma/client";
import type { PersonWithEmployee } from "../model/employee-model";

export type AdminVariables = {
  admin: AdminUser;
};

export type EmployeeVariables = {
  employee: PersonWithEmployee;
};

export type ApiClientVariables = {
  clientId: string;
  clientName: string;
  scopes: string[];
};
