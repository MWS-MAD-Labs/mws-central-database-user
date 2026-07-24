import { z } from "zod";
import { StudentStatus } from "../generated/prisma/client";

const STUDENT_STATUS_VALUES = Object.keys(StudentStatus) as [
  keyof typeof StudentStatus,
  ...(keyof typeof StudentStatus)[],
];

export class StudentApiValidation {
  static readonly LOOKUP = z
    .object({
      nis: z.string().min(1).optional(),
      email: z.email("A valid email is required").optional(),
    })
    .refine((val) => Boolean(val.nis || val.email), {
      message: "Either 'nis' or 'email' query parameter is required",
    });

  static readonly LIST = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    status: z.enum(STUDENT_STATUS_VALUES).optional(),
    current_grade_id: z.string().optional(),
    current_class_id: z.string().optional(),
    academic_year_id: z.string().optional(),
  });
}
