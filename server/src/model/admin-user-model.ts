import type { AdminRole } from "../generated/prisma/client";

export type PromoteEmployeeRequest = {
  employee_id: string;
  role: AdminRole;
  can_write_data?: boolean;
};
