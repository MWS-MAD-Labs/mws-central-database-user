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
    activity_id: z.string().min(1, "PC Activity ID is required"),
    academic_year_id: z
      .string()
      .min(1, "Academic year ID cannot be an empty string")
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

// Master Data > PC Activities > Manage Mentors - per-unit default mentor
// rows, not the per-student assignment validated above.
export class PCActivityDefaultMentorValidation {
  static readonly LIST = z.object({
    activity_id: z.string().min(1, "PC Activity ID is required"),
  });

  static readonly SET = z.object({
    activity_id: z.string().min(1, "PC Activity ID is required"),
    unit_id: z.string().min(1, "Unit ID is required"),
    mentor_id: z.string().min(1, "Mentor ID is required"),
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
}
