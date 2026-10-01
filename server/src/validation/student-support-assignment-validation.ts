import { z } from "zod";
import { StudentSupportRole } from "../generated/prisma/client";

const STUDENT_SUPPORT_ROLE_VALUES = Object.keys(StudentSupportRole) as [
  keyof typeof StudentSupportRole,
  ...(keyof typeof StudentSupportRole)[],
];

export class StudentSupportAssignmentValidation {
  static readonly ASSIGN = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    employee_id: z.string().min(1, "Employee ID is required").optional(),
    intern_id: z.string().min(1, "Intern ID is required").optional(),
    role: z.enum(STUDENT_SUPPORT_ROLE_VALUES, {
      message: "Role must be a valid format",
    }),
    notes: z.string().max(500, "Notes is too long").optional(),
  }).refine((value) => Boolean(value.employee_id) !== Boolean(value.intern_id), {
    message: "Exactly one workforce member is required",
  });

  static readonly END = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly REACTIVATE = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET = z.object({
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET_BY_EMPLOYEE = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly GET_BY_INTERN = z.object({
    intern_id: z.string().min(1, "Intern ID is required"),
  });

  static readonly GET_ACTIVE_STUDENT_IDS = z.object({
    student_ids: z
      .array(z.string().min(1))
      .min(1, "At least one student ID is required")
      .max(200, "Too many student IDs at once"),
  });

  static readonly SEARCH_CANDIDATES = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    unit_id: z.string().optional(),
  });
}
