import { z } from "zod";
import { ClassStatus, ClassTeacherRole } from "../generated/prisma/client";
import { CLASS_SORT_FIELDS } from "../model/class-model";

const CLASS_STATUS_VALUES = Object.keys(ClassStatus) as [
  keyof typeof ClassStatus,
  ...(keyof typeof ClassStatus)[],
];

const CLASS_TEACHER_ROLE_VALUES = Object.keys(ClassTeacherRole) as [
  keyof typeof ClassTeacherRole,
  ...(keyof typeof ClassTeacherRole)[],
];

export class ClassValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    grade_id: z.string().min(1, "Grade ID is required"),
    academic_year_id: z.string().min(1, "Academic Year ID is required"),
    status: z
      .enum(CLASS_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    capacity: z
      .number()
      .int("Capacity must be a whole number")
      .positive("Capacity must be greater than zero")
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
    status: z
      .enum(CLASS_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    capacity: z
      .number()
      .int("Capacity must be a whole number")
      .positive("Capacity must be greater than zero")
      .nullable()
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Class ID is required"),
  });

  static readonly ASSIGN_TEACHER = z.object({
    class_id: z.string().min(1, "Class ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
    role: z.enum(CLASS_TEACHER_ROLE_VALUES, {
      message: "Role must be a valid format",
    }),
    subject: z
      .string()
      .min(1, "Subject cannot be an empty string")
      .max(100, "Subject is too long")
      .optional(),
  });

  static readonly END_TEACHER_ASSIGNMENT = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    class_id: z.string().min(1, "Class ID is required"),
  });

  static readonly REMOVE_TEACHER_ASSIGNMENT = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    class_id: z.string().min(1, "Class ID is required"),
  });

  static readonly REOPEN_TEACHER_ASSIGNMENT = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    class_id: z.string().min(1, "Class ID is required"),
  });

  static readonly BULK_MOVE_TEACHER_ASSIGNMENTS = z.object({
    class_id: z.string().min(1, "Class ID is required"),
    assignment_ids: z
      .array(z.string().min(1, "Assignment ID is required"))
      .min(1, "Select at least one teacher assignment")
      .max(100, "Bulk move can process up to 100 assignments at once"),
    target_class_id: z.string().min(1, "Target class ID is required"),
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
