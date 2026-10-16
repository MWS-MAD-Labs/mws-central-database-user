import { z } from "zod";
import { InternStatus } from "../generated/prisma/client";

const INTERN_STATUS_VALUES = Object.keys(InternStatus) as [keyof typeof InternStatus, ...(keyof typeof InternStatus)[]];

export class InternApiValidation {
  static readonly LOOKUP = z
    .object({
      id: z.string().min(1).optional(),
      person_id: z.string().min(1).optional(),
      email: z.email("A valid email is required").optional(),
    })
    .refine((value) => Boolean(value.id || value.person_id || value.email), {
      message: "Either 'id', 'person_id' or 'email' query parameter is required",
    });

  static readonly LIST = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    status: z.enum(INTERN_STATUS_VALUES).optional(),
    unit_id: z.string().optional(),
    job_position_id: z.string().optional(),
    q: z.string().trim().min(1).max(200).optional(),
  });
}
