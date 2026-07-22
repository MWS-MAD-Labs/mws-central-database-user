import { z } from "zod";
import { PCDay } from "../generated/prisma/client";

const PC_DAY_VALUES = Object.keys(PCDay) as [
  keyof typeof PCDay,
  ...(keyof typeof PCDay)[],
];

export class PCActivityValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    day: z.enum(PC_DAY_VALUES, { message: "Day must be a valid format" }),
    activity: z
      .string()
      .min(1, "Activity is required")
      .max(100, "Activity is too long"),
    mentor_id: z.string().min(1, "Mentor ID cannot be an empty string").optional(),
    academic_year_id: z
      .string()
      .min(1, "Academic year ID cannot be an empty string")
      .optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    activity: z
      .string()
      .min(1, "Activity is required")
      .max(100, "Activity is too long")
      .optional(),
    mentor_id: z
      .string()
      .min(1, "Mentor ID cannot be an empty string")
      .nullable()
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly RESTORE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET_LIST = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    is_deleted: z.boolean().default(false).optional(),
  });
}
