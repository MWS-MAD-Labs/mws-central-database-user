import type { AdminUser } from "../generated/prisma/client";

export type AdminVariables = {
  admin: AdminUser;
};

export type ApiClientVariables = {
  clientId: string;
  clientName: string;
  scopes: string[];
};
