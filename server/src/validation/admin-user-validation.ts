import { z } from "zod";
import { AdminRole } from "../generated/prisma/client";
import { AFTER_HOURS_GRANT_MAX_MINUTES } from "../utils/office-hours";
import { ADMIN_USER_SORT_FIELDS } from "../model/admin-user-model";

const ADMIN_ROLE_VALUES = Object.keys(AdminRole) as [
  keyof typeof AdminRole,
  ...(keyof typeof AdminRole)[],
];

export class AdminUserValidation {
  static readonly PROMOTE = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
    role: z.enum(ADMIN_ROLE_VALUES),
  });

  static readonly SEARCH_PROMOTABLE_EMPLOYEES = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().trim().optional(),
  });

  static readonly SET_CAN_VIEW_SENSITIVE_DATA = z.object({
    can_view_sensitive_data: z.boolean({
      message: "can_view_sensitive_data is required and must be a boolean",
    }),
  });

  static readonly SET_CAN_VIEW_ALL_STUDENT_UNITS = z.object({
    can_view_all_student_units: z.boolean({
      message: "can_view_all_student_units is required and must be a boolean",
    }),
  });

  static readonly SET_CAN_VIEW_ALL_EMPLOYEE_UNITS = z.object({
    can_view_all_employee_units: z.boolean({
      message: "can_view_all_employee_units is required and must be a boolean",
    }),
  });

  static readonly SET_CAN_APPROVE_IDENTIFIER_CHANGES = z.object({
    can_approve_identifier_changes: z.boolean({
      message: "can_approve_identifier_changes is required and must be a boolean",
    }),
  });

  static readonly SET_CAN_VIEW_EMPLOYEE_PII = z.object({
    can_view_employee_pii: z.boolean({
      message: "can_view_employee_pii is required and must be a boolean",
    }),
  });

  static readonly SET_CAN_WRITE_EMPLOYEE_DATA = z.object({
    can_write_employee_data: z.boolean({
      message: "can_write_employee_data is required and must be a boolean",
    }),
  });

  static readonly SET_CAN_WRITE_STUDENT_DATA = z.object({
    can_write_student_data: z.boolean({
      message: "can_write_student_data is required and must be a boolean",
    }),
  });

  static readonly SET_CAN_VIEW_STUDENT_DATA = z.object({
    can_view_student_data: z.boolean(),
  });

  static readonly SET_CAN_VIEW_EMPLOYEE_DATA = z.object({
    can_view_employee_data: z.boolean(),
  });

  static readonly SET_CAN_VIEW_EMPLOYEE_DISCIPLINARY_DATA = z.object({
    can_view_employee_disciplinary_data: z.boolean(),
  });

  static readonly SET_CAN_MANAGE_ENROLLMENTS = z.object({
    can_manage_enrollments: z.boolean(),
  });

  static readonly SET_CAN_MANAGE_TEACHER_ASSIGNMENTS = z.object({
    can_manage_teacher_assignments: z.boolean(),
  });

  static readonly UPDATE_PERMISSIONS = z.object({
    can_view_student_data: z.boolean(),
    can_view_employee_data: z.boolean(),
    can_view_employee_disciplinary_data: z.boolean(),
    can_view_sensitive_data: z.boolean(),
    can_view_employee_pii: z.boolean(),
    can_view_all_student_units: z.boolean(),
    can_view_all_employee_units: z.boolean(),
    // Ignored (kept empty) while the matching all-units flag is true -
    // widening scope and picking specific units are mutually exclusive.
    student_view_unit_ids: z
      .array(z.string().min(1))
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "student_view_unit_ids must not contain duplicates",
      })
      .default([]),
    employee_view_unit_ids: z
      .array(z.string().min(1))
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "employee_view_unit_ids must not contain duplicates",
      })
      .default([]),
    can_write_student_data: z.boolean(),
    can_write_employee_data: z.boolean(),
    can_manage_enrollments: z.boolean(),
    can_manage_teacher_assignments: z.boolean(),
  });

  static readonly CHANGE_ROLE = z.object({
    role: z.enum(["DATABASE_ADMIN", "VIEWER"], {
      message: "Role must be either DATABASE_ADMIN or VIEWER",
    }),
  });

  static readonly DEMOTE_SUPER_ADMIN = z.object({
    role: z.enum(["DATABASE_ADMIN", "VIEWER"], {
      message: "Role must be either DATABASE_ADMIN or VIEWER",
    }),
  });

  static readonly GRANT_AFTER_HOURS_WRITE = z.object({
    minutes: z
      .number({ message: "minutes is required and must be a number" })
      .int("minutes must be a whole number")
      .positive("minutes must be greater than 0")
      .max(
        AFTER_HOURS_GRANT_MAX_MINUTES,
        `minutes cannot exceed ${AFTER_HOURS_GRANT_MAX_MINUTES} (4 hours)`,
      ),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    role: z
      .enum(ADMIN_ROLE_VALUES, { message: "Role must be a valid format" })
      .optional(),
    is_active: z.boolean().optional(),
    sort_by: z.enum(ADMIN_USER_SORT_FIELDS).default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });
}
