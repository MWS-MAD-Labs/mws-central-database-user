import { z } from "zod";
import { StudentSupportRole } from "../generated/prisma/client";

const STUDENT_SUPPORT_ROLE_VALUES = Object.keys(StudentSupportRole) as [
  keyof typeof StudentSupportRole,
  ...(keyof typeof StudentSupportRole)[],
];

export class StudentSupportAssignmentValidation {
  static readonly ASSIGN = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
    role: z.enum(STUDENT_SUPPORT_ROLE_VALUES, {
      message: "Role must be a valid format",
    }),
    notes: z.string().max(500, "Notes is too long").optional(),
  });

  static readonly END = z.object({
    id: z.string().min(1, "Assignment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET = z.object({
    student_id: z.string().min(1, "Student ID is required"),
  });
}
