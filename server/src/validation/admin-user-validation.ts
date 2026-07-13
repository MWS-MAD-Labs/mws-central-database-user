import { z } from "zod";
import { AdminRole } from "../generated/prisma/client";

const ADMIN_ROLE_VALUES = Object.keys(AdminRole) as [
  keyof typeof AdminRole,
  ...(keyof typeof AdminRole)[],
];

export class AdminUserValidation {
  static readonly PROMOTE = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
    role: z.enum(ADMIN_ROLE_VALUES),
    can_create_data: z.boolean().optional(),
  });
}
