import { z } from "zod";
import {
  Gender,
  Religion,
  EmploymentType,
  EmployeeStatus,
} from "../generated/prisma/client";

const GENDER_VALUES = Object.keys(Gender) as [
  keyof typeof Gender,
  ...(keyof typeof Gender)[],
];

const RELIGION_VALUES = Object.keys(Religion) as [
  keyof typeof Religion,
  ...(keyof typeof Religion)[],
];

const EMPLOYMENT_TYPE_VALUES = Object.keys(EmploymentType) as [
  keyof typeof EmploymentType,
  ...(keyof typeof EmploymentType)[],
];

const EMPLOYEE_STATUS_VALUES = Object.keys(EmployeeStatus) as [
  keyof typeof EmployeeStatus,
  ...(keyof typeof EmployeeStatus)[],
];

export class EmployeeValidation {
  static readonly CREATE = z.object({
    full_name: z
      .string()
      .min(1, "Full name is required")
      .max(50, "Full name is too long"),
    nick_name: z
      .string()
      .min(1, "Nick name is required")
      .max(25, "Nick name is too long"),
    email: z
      .email("Invalid email format")
      .min(1, "Email is required")
      .max(50, "Email is too long"),

    gender: z.enum(GENDER_VALUES, {
      message: "Gender is required and must be a valid format",
    }),
    religion: z.enum(RELIGION_VALUES, {
      message: "Religion is required and must be a valid format",
    }),

    birth_place: z
      .string()
      .min(1, "Birth place is required")
      .max(25, "Birth place too long"),
    birth_date: z.iso.datetime(
      "Birth date must be a valid ISO-8601 datetime string",
    ),
    photo_url: z.url("Photo must be a valid URL").optional(),

    employee_id: z
      .string()
      .min(1, "Employee ID is required")
      .max(25, "Employee ID too long")
      .regex(
        /^\d{2}\.\d{2}\.\d{3}$/,
        "Invalid Employee ID format. Example: 12.01.123",
      ),

    status: z.enum(EMPLOYEE_STATUS_VALUES, {
      message: "Status ise required and must be a valid format",
    }),

    employment_type: z.enum(EMPLOYMENT_TYPE_VALUES, {
      message: "Employment type is required and must be a valid format",
    }),

    unit_id: z.string().min(1, "Unit ID is required"),
    job_position_id: z.string().min(1, "Job Position ID is required"),
    job_level_id: z.string().min(1, "Job Level ID is required"),

    building: z
      .string()
      .min(1, "Building is required")
      .max(25, "Building is too long"),
    join_date: z.iso.datetime(
      "Join date must be a valid ISO-8601 datetime string",
    ),

    assigned_class: z.string().max(50).optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Employee internal ID is required"),

    full_name: z
      .string()
      .min(1, "Full name is required")
      .max(50, "Full name is too long")
      .optional(),

    nick_name: z
      .string()
      .min(1, "Nick name is required")
      .max(25, "Nick name is too long")
      .optional(),

    email: z
      .email("Invalid email format")
      .min(1, "Email is required")
      .max(50, "Email is too long")
      .optional(),

    gender: z
      .enum(GENDER_VALUES, {
        message: "Gender is required and must be a valid format",
      })
      .optional(),

    religion: z
      .enum(RELIGION_VALUES, {
        message: "Religion is required and must be a valid format",
      })
      .optional(),

    birth_place: z
      .string()
      .min(1, "Birth place is required")
      .max(25, "Birth place too long")
      .optional(),

    birth_date: z.iso
      .datetime("Birth date must be a valid ISO-8601 datetime string")
      .optional(),

    photo_url: z.url("Photo must be a valid URL").optional(),

    employee_id: z
      .string()
      .min(1, "Employee ID is required")
      .max(25, "Employee ID too long")
      .regex(
        /^\d{2}\.\d{2}\.\d{3}$/,
        "Invalid Employee ID format. Example: 12.01.123",
      )
      .optional(),

    employment_type: z
      .enum(EMPLOYMENT_TYPE_VALUES, {
        message: "Employment type is required and must be a valid format",
      })
      .optional(),

    status: z
      .enum(EMPLOYEE_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),

    unit_id: z.string().min(1, "Unit ID is required").optional(),
    job_position_id: z
      .string()
      .min(1, "Job Position ID is required")
      .optional(),
    job_level_id: z.string().min(1, "Job Level ID is required").optional(),

    building: z
      .string()
      .min(1, "Building is required")
      .max(25, "Building is too long")
      .optional(),

    join_date: z.iso
      .datetime("Join date must be a valid ISO-8601 datetime string")
      .optional(),

    assigned_class: z.string().max(50).optional(),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),

    status: z.enum(EMPLOYEE_STATUS_VALUES).optional(),
    unit_id: z.string().optional(),
    job_level_id: z.string().optional(),
    job_position_id: z.string().optional(),
    building: z.string().optional(),
    gender: z.enum(GENDER_VALUES).optional(),
    religion: z.enum(RELIGION_VALUES).optional(),

    join_date_start: z.iso.datetime().optional(),
    join_date_end: z.iso.datetime().optional(),

    assigned_class: z.string().optional(),
    is_deleted: z.boolean().default(false).optional(),

    sort_by: z.string().default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });
}
