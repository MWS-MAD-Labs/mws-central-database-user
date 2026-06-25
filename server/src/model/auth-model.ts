import type { AdminRole } from "../generated/prisma/client";

export type AdminResponse = {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  avatar_url: string | null;
  unit_scope: string | null;
};
