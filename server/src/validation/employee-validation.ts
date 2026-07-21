import { z } from "zod";
import {
  Gender,
  Religion,
  EmploymentType,
  EmployeeStatus,
  MaritalStatus,
} from "../generated/prisma/client";
import { EMPLOYEE_SORT_FIELDS } from "../model/employee-model";
import { emailWithAllowedDomain } from "./validation";

// Strip everything but digits lets callers send NIK/BPJS/bank account
// numbers with dots, dashes, or spaces and still land on one uniform,
// storage-ready format instead of validating against several formats at once.
const normalizeDigits = (value: string) => value.replace(/\D/g, "");

// Accepts 08xx, +628xx, or 628xx and always normalizes to the 62-prefixed
// form actually stored in the DB.
const normalizeIndonesianPhone = (value: string) => {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+62")) return digits.slice(1);
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
};

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

const MARITAL_STATUS_VALUES = Object.keys(MaritalStatus) as [
  keyof typeof MaritalStatus,
  ...(keyof typeof MaritalStatus)[],
];

export class EmployeeValidation {
  static readonly CREATE = z
    .object({
      full_name: z
        .string()
        .min(1, "Full name is required")
        .max(50, "Full name is too long"),
      nick_name: z
        .string()
        .min(1, "Nick name is required")
        .max(25, "Nick name is too long"),
      email: emailWithAllowedDomain(),

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

      resignation_date: z.iso
        .datetime("Resignation date must be a valid ISO-8601 datetime string")
        .optional(),
      last_working_date: z.iso
        .datetime("Last working date must be a valid ISO-8601 datetime string")
        .optional(),
      notes: z.string().max(500, "Notes is too long").optional(),

      marital_status: z.enum(MARITAL_STATUS_VALUES, {
        message: "Marital status is required and must be a valid format",
      }),
      mobile_phone: z
        .string()
        .transform(normalizeIndonesianPhone)
        .refine(
          (val) => /^628[0-9]{7,10}$/.test(val),
          "Mobile phone must be a valid Indonesian number (e.g. 08xx, +628xx, or 628xx)",
        )
        .optional(),
      residential_address: z
        .string()
        .min(1, "Residential address cannot be empty")
        .max(200, "Residential address is too long")
        .optional(),
      nik: z
        .string()
        .transform(normalizeDigits)
        .refine((val) => /^\d{16}$/.test(val), "NIK must be exactly 16 digits")
        .optional(),
      npwp: z
        .string()
        .transform(normalizeDigits)
        .refine(
          (val) => /^\d{15}$/.test(val),
          "NPWP (old format) must be exactly 15 digits, e.g. 11.111.111.1-123.000",
        )
        .optional(),
      bank_account_number: z
        .string()
        .transform(normalizeDigits)
        .refine(
          (val) => /^\d{10}$/.test(val),
          "Bank account number must be exactly 10 digits (BCA)",
        )
        .optional(),
      bpjs_number: z
        .string()
        .transform(normalizeDigits)
        .refine(
          (val) => /^\d{13}$/.test(val),
          "BPJS number must be exactly 13 digits",
        )
        .optional(),
    })
    .refine(
      (data) =>
        data.status !== EmployeeStatus.RESIGNED || !!data.resignation_date,
      {
        message: "Resignation date is required when status is RESIGNED",
        path: ["resignation_date"],
      },
    );

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

    email: emailWithAllowedDomain().optional(),

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

    resignation_date: z.iso
      .datetime("Resignation date must be a valid ISO-8601 datetime string")
      .optional(),
    last_working_date: z.iso
      .datetime("Last working date must be a valid ISO-8601 datetime string")
      .optional(),
    notes: z.string().max(500, "Notes is too long").optional(),

    marital_status: z
      .enum(MARITAL_STATUS_VALUES, {
        message: "Marital status must be a valid format",
      })
      .optional(),
    mobile_phone: z
      .string()
      .transform(normalizeIndonesianPhone)
      .refine(
        (val) => /^628[0-9]{7,10}$/.test(val),
        "Mobile phone must be a valid Indonesian number (e.g. 08xx, +628xx, or 628xx)",
      )
      .optional(),
    residential_address: z
      .string()
      .min(1, "Residential address cannot be empty")
      .max(200, "Residential address is too long")
      .optional(),
    nik: z
      .string()
      .transform(normalizeDigits)
      .refine(
        (val) => /^\d{16}$/.test(val),
        "NIK (also used as the new-format NPWP) must be exactly 16 digits",
      )
      .optional(),
    npwp: z
      .string()
      .transform(normalizeDigits)
      .refine(
        (val) => /^\d{15}$/.test(val),
        "NPWP (old format) must be exactly 15 digits, e.g. 11.111.111.1-123.000",
      )
      .optional(),
    bank_account_number: z
      .string()
      .transform(normalizeDigits)
      .refine(
        (val) => /^\d{10}$/.test(val),
        "Bank account number must be exactly 10 digits (BCA)",
      )
      .optional(),
    bpjs_number: z
      .string()
      .transform(normalizeDigits)
      .refine(
        (val) => /^\d{13}$/.test(val),
        "BPJS number must be exactly 13 digits",
      )
      .optional(),
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

    is_deleted: z.boolean().default(false).optional(),

    sort_by: z.enum(EMPLOYEE_SORT_FIELDS).default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });
}
