import { z } from "zod";
import { AdminRole } from "../generated/prisma/client";
import { AFTER_HOURS_GRANT_MAX_MINUTES } from "../utils/office-hours";

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

  static readonly GRANT_AFTER_HOURS_WRITE = z.object({
    minutes: z
      .number({ message: "minutes is required and must be a number" })
      .int("minutes must be a whole number")
      .positive("minutes must be greater than 0")
      .max(
        AFTER_HOURS_GRANT_MAX_MINUTES,
        `minutes cannot exceed ${AFTER_HOURS_GRANT_MAX_MINUTES} (4 hours)`,
      ),
  });
}
