import { z } from "zod";
import { VaccineType } from "../generated/prisma/client";

const VACCINE_TYPE_VALUES = Object.keys(VaccineType) as [
  keyof typeof VaccineType,
  ...(keyof typeof VaccineType)[],
];

export class VaccineRecordValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    vaccine_type: z.enum(VACCINE_TYPE_VALUES, {
      message: "Vaccine type must be a valid format",
    }),
    received: z.boolean().optional(),
    date: z.iso
      .datetime("Date must be a valid ISO-8601 datetime string")
      .optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Vaccine record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    received: z.boolean().optional(),
    date: z.iso
      .datetime("Date must be a valid ISO-8601 datetime string")
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Vaccine record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly RESTORE = z.object({
    id: z.string().min(1, "Vaccine record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET_LIST = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    is_deleted: z.boolean().default(false).optional(),
  });
}
