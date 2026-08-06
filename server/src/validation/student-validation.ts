import { z } from "zod";
import {
  ConsentStatus,
  Gender,
  PCDay,
  Religion,
  StudentEntryType,
  StudentStatus,
} from "../generated/prisma/client";
import { STUDENT_SORT_FIELDS } from "../model/student-model";
import { emailWithAllowedDomain } from "./validation";

export const NIS_REGEX = /^\d{7}$/;
export const NIS_MESSAGE = "NIS must be exactly 7 digits";

const GENDER_VALUES = Object.keys(Gender) as [
  keyof typeof Gender,
  ...(keyof typeof Gender)[],
];

const RELIGION_VALUES = Object.keys(Religion) as [
  keyof typeof Religion,
  ...(keyof typeof Religion)[],
];

const STUDENT_STATUS_VALUES = Object.keys(StudentStatus) as [
  keyof typeof StudentStatus,
  ...(keyof typeof StudentStatus)[],
];

const CONSENT_STATUS_VALUES = Object.keys(ConsentStatus) as [
  keyof typeof ConsentStatus,
  ...(keyof typeof ConsentStatus)[],
];

const PC_DAY_VALUES = Object.keys(PCDay) as [
  keyof typeof PCDay,
  ...(keyof typeof PCDay)[],
];

const STUDENT_ENTRY_TYPE_VALUES = Object.keys(StudentEntryType) as [
  keyof typeof StudentEntryType,
  ...(keyof typeof StudentEntryType)[],
];

export class StudentValidation {
  static readonly CREATE = z.object({
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

    // Auto-generated server-side when omitted - only import supplies it
    // directly, already pattern-validated.
    nis: z
      .string()
      .refine((val) => NIS_REGEX.test(val), NIS_MESSAGE)
      .optional(),
    // Raw historical NIS from a legacy import - free text, no format
    // constraint, only used when the sheet's NIS doesn't fit NIS_REGEX.
    legacy_nis: z.string().max(50, "Legacy NIS is too long").optional(),
    nisn: z
      .string()
      .regex(/^\d{10}$/, "NISN must be exactly 10 digits")
      .optional(),
    status: z
      .enum(STUDENT_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    current_grade_id: z.string().min(1, "Current grade ID is required"),
    join_academic_year_id: z
      .string()
      .min(1, "Join academic year ID is required"),
    join_grade_id: z.string().min(1, "Join grade ID is required"),
    previous_school: z
      .string()
      .max(100, "Previous school is too long")
      .optional(),
    pickup_drop_service: z.boolean().optional(),
    catering_service: z.boolean().optional(),
    psb_guide: z.boolean().optional(),
    entry_type: z.enum(STUDENT_ENTRY_TYPE_VALUES, {
      message: "Entry type is required and must be a valid format",
    }),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Student internal ID is required"),

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

    // nis is intentionally not here - assigned once at create, never editable.
    nisn: z
      .string()
      .regex(/^\d{10}$/, "NISN must be exactly 10 digits")
      .optional(),
    status: z
      .enum(STUDENT_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    current_grade_id: z.string().min(1).optional(),
    join_academic_year_id: z.string().min(1).optional(),
    join_grade_id: z.string().min(1).optional(),
    previous_school: z
      .string()
      .max(100, "Previous school is too long")
      .optional(),
    graduation_grade: z
      .string()
      .max(25, "Graduation grade is too long")
      .optional(),
    leave_year: z.string().max(10, "Leave year is too long").optional(),
    sn: z.string().max(50, "SN is too long").optional(),
    // Only affects a future reissueNis() call's NIS digit 4 - editable so
    // legacy imports (defaulted to PSB, real value unknown from the sheet)
    // can be corrected before someone reissues that student's NIS.
    entry_type: z
      .enum(STUDENT_ENTRY_TYPE_VALUES, {
        message: "Entry type must be a valid format",
      })
      .optional(),
    pickup_drop_service: z.boolean().optional(),
    catering_service: z.boolean().optional(),
    psb_guide: z.boolean().optional(),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),

    gender: z.enum(GENDER_VALUES).optional(),
    religion: z.enum(RELIGION_VALUES).optional(),

    status: z.enum(STUDENT_STATUS_VALUES).optional(),
    current_grade_id: z.string().optional(),
    current_class_id: z.string().optional(),
    join_academic_year_id: z.string().optional(),
    leave_year: z.string().optional(),

    pickup_drop_service: z.boolean().optional(),
    catering_service: z.boolean().optional(),
    psb_guide: z.boolean().optional(),

    consent_status: z.enum(CONSENT_STATUS_VALUES).optional(),
    pc_activity_day: z.enum(PC_DAY_VALUES).optional(),

    is_deleted: z.boolean().default(false).optional(),

    sort_by: z.enum(STUDENT_SORT_FIELDS).default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });

  static readonly BULK_IDS = z.object({
    ids: z
      .array(z.string().min(1, "Student ID is required"))
      .min(1, "Select at least one student")
      .max(100, "Bulk action can process up to 100 students at once"),
  });

  // entry_type is required (not optional, no default) - it feeds NIS digit
  // 4 and must be an explicit admin confirmation at the moment the NIS is
  // actually generated, not whatever value happened to be stored (often
  // still the import-time PSB default for legacy rows).
  static readonly REISSUE_NIS = z.object({
    id: z.string().min(1, "Student internal ID is required"),
    entry_type: z.enum(STUDENT_ENTRY_TYPE_VALUES, {
      message: "Entry type is required and must be a valid format",
    }),
  });
}
