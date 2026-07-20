import { z } from "zod";
import { ClassStatus } from "../generated/prisma/client";
import { CLASS_SORT_FIELDS } from "../model/class-model";

const CLASS_STATUS_VALUES = Object.keys(ClassStatus) as [
  keyof typeof ClassStatus,
  ...(keyof typeof ClassStatus)[],
];

export class ClassValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    grade_id: z.string().min(1, "Grade ID is required"),
    academic_year_id: z.string().min(1, "Academic Year ID is required"),
    homeroom_teacher_id: z
      .string()
      .min(1, "Homeroom teacher ID cannot be an empty string")
      .max(50, "Homeroom teacher ID is too long")
      .optional(),
    status: z
      .enum(CLASS_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Class ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name is too long")
      .optional(),
    grade_id: z.string().min(1, "Grade ID is required").optional(),
    academic_year_id: z
      .string()
      .min(1, "Academic Year ID is required")
      .optional(),
    homeroom_teacher_id: z
      .string()
      .min(1, "Homeroom teacher ID cannot be an empty string")
      .max(50, "Homeroom teacher ID is too long")
      .nullable()
      .optional(),
    status: z
      .enum(CLASS_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Class ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    grade_id: z.string().optional(),
    academic_year_id: z.string().optional(),
    status: z
      .enum(CLASS_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    sort_by: z.enum(CLASS_SORT_FIELDS).default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });
}
