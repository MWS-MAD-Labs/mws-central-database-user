import { z } from "zod";
import { EmployeeStatus } from "../generated/prisma/client";

const EMPLOYEE_STATUS_VALUES = Object.keys(EmployeeStatus) as [
  keyof typeof EmployeeStatus,
  ...(keyof typeof EmployeeStatus)[],
];

export class EmployeeApiValidation {
  static readonly LOOKUP = z
    .object({
      employee_id: z.string().min(1).optional(),
      email: z.email("A valid email is required").optional(),
    })
    .refine((val) => Boolean(val.employee_id || val.email), {
      message: "Either 'employee_id' or 'email' query parameter is required",
    });

  static readonly LIST = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    status: z.enum(EMPLOYEE_STATUS_VALUES).optional(),
    unit_id: z.string().optional(),
    job_position_id: z.string().optional(),
  });
}
