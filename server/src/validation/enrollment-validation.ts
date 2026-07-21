import { z } from "zod";
import { EnrollmentStatus } from "../generated/prisma/client";
import { ENROLLMENT_SORT_FIELDS } from "../model/enrollment-model";

const ENROLLMENT_STATUS_VALUES = Object.keys(EnrollmentStatus) as [
  keyof typeof EnrollmentStatus,
  ...(keyof typeof EnrollmentStatus)[],
];

const CLOSE_STATUS_VALUES = ["TRANSFERRED", "WITHDRAWN"] as const;

export class EnrollmentValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    class_id: z.string().min(1, "Class ID is required"),
    academic_year_id: z
      .string()
      .min(1, "Academic year ID is required")
      .optional(),
    start_date: z.iso
      .datetime("Start date must be a valid ISO-8601 datetime string")
      .optional(),
  });

  static readonly PROMOTE = z.object({
    id: z.string().min(1, "Enrollment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    class_id: z.string().min(1, "Class ID is required"),
    academic_year_id: z.string().min(1, "Academic year ID is required"),
    grade_id: z.string().min(1, "Grade ID is required"),
    effective_date: z.iso
      .datetime("Effective date must be a valid ISO-8601 datetime string")
      .optional(),
  });

  static readonly TRANSFER = z.object({
    id: z.string().min(1, "Enrollment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    class_id: z.string().min(1, "Class ID is required"),
  });

  static readonly CLOSE = z.object({
    id: z.string().min(1, "Enrollment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    status: z.enum(CLOSE_STATUS_VALUES, {
      message: "Status must be either TRANSFERRED or WITHDRAWN",
    }),
    end_date: z.iso
      .datetime("End date must be a valid ISO-8601 datetime string")
      .optional(),
  });

  static readonly GET_HISTORY = z.object({
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    student_id: z.string().optional(),
    class_id: z.string().optional(),
    academic_year_id: z.string().optional(),
    status: z
      .enum(ENROLLMENT_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    sort_by: z.enum(ENROLLMENT_SORT_FIELDS).default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });
}
