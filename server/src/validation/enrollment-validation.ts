import { z } from "zod";
import { EnrollmentStatus } from "../generated/prisma/client";
import { ENROLLMENT_SORT_FIELDS } from "../model/enrollment-model";

const ENROLLMENT_STATUS_VALUES = Object.keys(EnrollmentStatus) as [
  keyof typeof EnrollmentStatus,
  ...(keyof typeof EnrollmentStatus)[],
];

const CLOSE_STATUS_VALUES = ["COMPLETED", "TRANSFERRED", "WITHDRAWN"] as const;

export class EnrollmentValidation {
  static readonly CREATE = z
    .object({
      student_id: z.string().min(1, "Student ID is required"),
      class_id: z.string().min(1, "Class ID is required"),
      academic_year_id: z
        .string()
        .min(1, "Academic year ID is required")
        .optional(),
      start_date: z.iso
        .datetime("Start date must be a valid ISO-8601 datetime string")
        .optional(),
      force: z.boolean().optional(),
      is_legacy: z.boolean().optional(),
      status: z
        .enum(ENROLLMENT_STATUS_VALUES, {
          message: "Status must be a valid format",
        })
        .optional(),
      end_date: z.iso
        .datetime("End date must be a valid ISO-8601 datetime string")
        .optional(),
    })
    .refine((data) => !data.is_legacy || !!data.academic_year_id, {
      message: "Academic year is required for a historical enrollment",
      path: ["academic_year_id"],
    });

  static readonly BULK_CREATE = z
    .object({
      student_ids: z
        .array(z.string().min(1, "Student ID is required"))
        .min(1, "Select at least one student")
        .max(100, "Bulk enrollment can process up to 100 students at once"),
      class_id: z.string().min(1, "Class ID is required"),
      academic_year_id: z
        .string()
        .min(1, "Academic year ID is required")
        .optional(),
      start_date: z.iso
        .datetime("Start date must be a valid ISO-8601 datetime string")
        .optional(),
      force: z.boolean().optional(),
      is_legacy: z.boolean().optional(),
      status: z
        .enum(ENROLLMENT_STATUS_VALUES, {
          message: "Status must be a valid format",
        })
        .optional(),
      end_date: z.iso
        .datetime("End date must be a valid ISO-8601 datetime string")
        .optional(),
    })
    .refine((data) => !data.is_legacy || !!data.academic_year_id, {
      message: "Academic year is required for a historical enrollment",
      path: ["academic_year_id"],
    });

  static readonly PROMOTE = z
    .object({
      id: z.string().min(1, "Enrollment ID is required"),
      student_id: z.string().min(1, "Student ID is required"),
      class_id: z.string().min(1, "Class ID is required"),
      academic_year_id: z.string().min(1, "Academic year ID is required"),
      grade_id: z.string().min(1, "Grade ID is required"),
      effective_date: z.iso
        .datetime("Effective date must be a valid ISO-8601 datetime string")
        .optional(),
      is_retention: z.boolean().optional(),
      retention_reason: z
        .string()
        .min(1, "Retention reason is required")
        .max(300, "Retention reason is too long")
        .optional(),
      force: z.boolean().optional(),
    })
    .refine((data) => !data.is_retention || !!data.retention_reason, {
      message: "Retention reason is required when is_retention is true",
      path: ["retention_reason"],
    });

  static readonly BULK_PROMOTE = z
    .object({
      enrollment_ids: z
        .array(z.string().min(1, "Enrollment ID is required"))
        .min(1, "Select at least one enrollment")
        .max(100, "Bulk promote can process up to 100 enrollments at once"),
      class_id: z.string().min(1, "Class ID is required"),
      academic_year_id: z.string().min(1, "Academic year ID is required"),
      grade_id: z.string().min(1, "Grade ID is required"),
      effective_date: z.iso
        .datetime("Effective date must be a valid ISO-8601 datetime string")
        .optional(),
      is_retention: z.boolean().optional(),
      retention_reason: z
        .string()
        .min(1, "Retention reason is required")
        .max(300, "Retention reason is too long")
        .optional(),
      force: z.boolean().optional(),
    })
    .refine((data) => !data.is_retention || !!data.retention_reason, {
      message: "Retention reason is required when is_retention is true",
      path: ["retention_reason"],
    });

  static readonly TRANSFER = z.object({
    id: z.string().min(1, "Enrollment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    class_id: z.string().min(1, "Class ID is required"),
    force: z.boolean().optional(),
  });

  static readonly BULK_TRANSFER = z.object({
    enrollment_ids: z
      .array(z.string().min(1, "Enrollment ID is required"))
      .min(1, "Select at least one enrollment")
      .max(100, "Bulk transfer can process up to 100 enrollments at once"),
    class_id: z.string().min(1, "Class ID is required"),
    force: z.boolean().optional(),
  });

  static readonly CLOSE = z.object({
    id: z.string().min(1, "Enrollment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    status: z.enum(CLOSE_STATUS_VALUES, {
      message: "Status must be COMPLETED, TRANSFERRED, or WITHDRAWN",
    }),
    end_date: z.iso
      .datetime("End date must be a valid ISO-8601 datetime string")
      .optional(),
    graduation_grade: z
      .string()
      .max(100, "Graduation grade is too long")
      .optional(),
    leave_year: z.string().max(20, "Leave year is too long").optional(),
  });

  static readonly BULK_CLOSE = z.object({
    enrollment_ids: z
      .array(z.string().min(1, "Enrollment ID is required"))
      .min(1, "Select at least one enrollment")
      .max(100, "Bulk close can process up to 100 enrollments at once"),
    status: z.enum(CLOSE_STATUS_VALUES, {
      message: "Status must be COMPLETED, TRANSFERRED, or WITHDRAWN",
    }),
    end_date: z.iso
      .datetime("End date must be a valid ISO-8601 datetime string")
      .optional(),
    graduation_grade: z
      .string()
      .max(100, "Graduation grade is too long")
      .optional(),
    leave_year: z.string().max(20, "Leave year is too long").optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Enrollment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly RESTORE = z.object({
    id: z.string().min(1, "Enrollment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly REACTIVATE = z.object({
    id: z.string().min(1, "Enrollment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    force: z.boolean().optional(),
  });

  static readonly ROLLBACK_PROMOTE = z.object({
    id: z.string().min(1, "Enrollment ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    force: z.boolean().optional(),
  });

  static readonly BULK_ROLLBACK_PROMOTE = z.object({
    enrollment_ids: z
      .array(z.string().min(1, "Enrollment ID is required"))
      .min(1, "Select at least one enrollment")
      .max(100, "Bulk rollback can process up to 100 enrollments at once"),
    force: z.boolean().optional(),
  });

  static readonly GET_HISTORY = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    is_deleted: z.boolean().default(false).optional(),
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
    is_deleted: z.boolean().default(false).optional(),
    sort_by: z.enum(ENROLLMENT_SORT_FIELDS).default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });
}
