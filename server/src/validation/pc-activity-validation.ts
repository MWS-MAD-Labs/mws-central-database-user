import { z } from "zod";
import { PCDay } from "../generated/prisma/client";
import { PC_ACTIVITY_MASTER_SORT_FIELDS } from "../model/pc-activity-model";

export const PC_DAY_VALUES = Object.keys(PCDay) as [
  keyof typeof PCDay,
  ...(keyof typeof PCDay)[],
];

export class PCActivityValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    day: z.enum(PC_DAY_VALUES, { message: "Day must be a valid format" }),
    activity_id: z.string().min(1, "PC Activity ID is required"),
    academic_year_id: z
      .string()
      .min(1, "Academic year ID cannot be an empty string")
      .optional(),
    // Set only when created through the class-first bulk-enroll flow.
    class_activity_id: z
      .string()
      .min(1, "Class activity ID cannot be an empty string")
      .optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    activity_id: z.string().min(1, "PC Activity ID is required").optional(),
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

export class PCActivityMasterValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    unit_ids: z.array(z.string().min(1)).optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name is too long")
      .optional(),
    unit_ids: z.array(z.string().min(1)).optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    sort_by: z.enum(PC_ACTIVITY_MASTER_SORT_FIELDS).default("name").optional(),
    sort_order: z.enum(["asc", "desc"]).default("asc").optional(),
  });

  static readonly PREVIEW_REASSIGNMENT = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    unit_ids: z.array(z.string().min(1)),
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
  });
}

export class PCActivityDefaultMentorValidation {
  static readonly LIST = z.object({
    activity_id: z.string().min(1, "PC Activity ID is required"),
  });

  static readonly SET = z.object({
    activity_id: z.string().min(1, "PC Activity ID is required"),
    unit_id: z.string().min(1, "Unit ID is required"),
    mentor_id: z.string().min(1, "Mentor ID is required").optional(),
    intern_id: z.string().min(1, "Intern ID is required").optional(),
  }).refine((value) => Boolean(value.mentor_id) !== Boolean(value.intern_id), {
    message: "Exactly one workforce member is required",
  });

  static readonly CLEAR = z.object({
    activity_id: z.string().min(1, "PC Activity ID is required"),
    unit_id: z.string().min(1, "Unit ID is required"),
  });

  static readonly LIST_BATCH = z.object({
    activity_ids: z.array(z.string().min(1)).min(1, "At least one activity ID is required"),
  });

  static readonly LIST_FOR_EMPLOYEE = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly LIST_FOR_INTERN = z.object({
    intern_id: z.string().min(1, "Intern ID is required"),
  });
}
