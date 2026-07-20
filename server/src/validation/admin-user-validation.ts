import { z } from "zod";
import { AdminRole } from "../generated/prisma/client";
import { AFTER_HOURS_GRANT_MAX_MINUTES } from "../utils/office-hours";
import { ADMIN_USER_SORT_FIELDS } from "../model/admin-user-model";

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

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    role: z
      .enum(ADMIN_ROLE_VALUES, { message: "Role must be a valid format" })
      .optional(),
    is_active: z.boolean().optional(),
    sort_by: z.enum(ADMIN_USER_SORT_FIELDS).default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });
}
