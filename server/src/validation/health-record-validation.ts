import { z } from "zod";
import { BloodType } from "../generated/prisma/client";

const BLOOD_TYPE_VALUES = Object.keys(BloodType) as [
  keyof typeof BloodType,
  ...(keyof typeof BloodType)[],
];

export class HealthRecordValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    blood_type: z
      .enum(BLOOD_TYPE_VALUES, { message: "Blood type must be a valid format" })
      .optional(),
    needs_assistance: z.boolean().optional(),
  });

  static readonly UPDATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    blood_type: z
      .enum(BLOOD_TYPE_VALUES, { message: "Blood type must be a valid format" })
      .optional(),
    needs_assistance: z.boolean().optional(),
  });

  static readonly DELETE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly RESTORE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET = z.object({
    student_id: z.string().min(1, "Student ID is required"),
  });
}
