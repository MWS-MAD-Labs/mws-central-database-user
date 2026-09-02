import { z } from "zod";
import { PCDay } from "../generated/prisma/client";
import { MASTER_PC_ACTIVITY_SORT_FIELDS } from "../model/pc-activity-model";

const PC_DAY_VALUES = Object.keys(PCDay) as [
  keyof typeof PCDay,
  ...(keyof typeof PCDay)[],
];

export class PCActivityValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    day: z.enum(PC_DAY_VALUES, { message: "Day must be a valid format" }),
    activity_id: z.string().min(1, "PC Activity ID is required"),
    mentor_id: z.string().min(1, "Mentor ID cannot be an empty string").optional(),
    academic_year_id: z
      .string()
      .min(1, "Academic year ID cannot be an empty string")
      .optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    activity_id: z.string().min(1, "PC Activity ID is required").optional(),
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

// Master-data catalog (Master Data > PC Activities), not the per-student
// assignment validated above.
export class MasterPCActivityValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    default_mentor_id: z
      .string()
      .min(1, "Mentor ID cannot be an empty string")
      .optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name is too long")
      .optional(),
    default_mentor_id: z
      .string()
      .min(1, "Mentor ID cannot be an empty string")
      .nullable()
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "ID is required"),
  });

  static readonly GET = z.object({
    id: z.string().min(1, "ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    sort_by: z
      .enum(MASTER_PC_ACTIVITY_SORT_FIELDS)
      .default("name")
      .optional(),
    sort_order: z.enum(["asc", "desc"]).default("asc").optional(),
  });
}
