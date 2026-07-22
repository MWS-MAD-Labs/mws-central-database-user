import { z } from "zod";

export class HealthRecordValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    blood_type: z.string().max(10, "Blood type is too long").optional(),
    needs_assistance: z.boolean().optional(),
  });

  static readonly UPDATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    blood_type: z.string().max(10, "Blood type is too long").optional(),
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
