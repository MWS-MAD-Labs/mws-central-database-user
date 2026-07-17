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
    can_write_data: z.boolean().optional(),
  });

  static readonly SET_CAN_WRITE_DATA = z.object({
    can_write_data: z.boolean({
      message: "can_write_data is required and must be a boolean",
    }),
  });
}
