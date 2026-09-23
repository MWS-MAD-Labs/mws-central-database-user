import { z } from "zod";
import { EmployeeStatus } from "../generated/prisma/client";

const EMPLOYEE_STATUS_VALUES = Object.keys(EmployeeStatus) as [
  keyof typeof EmployeeStatus,
  ...(keyof typeof EmployeeStatus)[],
];

export class EmployeeApiValidation {
  static readonly LOOKUP = z
    .object({
      // Internal Employee.id - for a caller that already resolved someone
      // once (e.g. mws-hub re-verifying a session) and wants a stable
      // re-lookup that doesn't break if the person's email changes here in
      // the meantime. employee_id/email remain the entry point for a
      // caller that only has one of those (e.g. a fresh Google sign-in).
      id: z.string().min(1).optional(),
      person_id: z.string().min(1).optional(),
      employee_id: z.string().min(1).optional(),
      email: z.email("A valid email is required").optional(),
    })
    .refine((val) => Boolean(val.id || val.person_id || val.employee_id || val.email), {
      message: "Either 'id', 'person_id', 'employee_id', or 'email' query parameter is required",
    });

  static readonly LIST = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    status: z.enum(EMPLOYEE_STATUS_VALUES).optional(),
    unit_id: z.string().optional(),
    job_position_id: z.string().optional(),
    q: z.string().trim().min(1).max(200).optional(),
  });
}
