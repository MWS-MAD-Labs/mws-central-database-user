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
import {
  emailWithAllowedDomain,
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
} from "./validation";

export const NIS_REGEX = /^\d{7}$/;
export const NIS_MESSAGE = "NIS must be exactly 7 digits";
export const NISN_REGEX = /^\d{10}$/;
export const NISN_MESSAGE = "NISN must be exactly 10 digits";

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
    religion_other: z.string().max(50, "Religion detail is too long").nullable().optional(),

    birth_place: z
      .string()
      .min(1, "Birth place is required")
      .max(25, "Birth place too long"),
    birth_date: z.iso.datetime(
      "Birth date must be a valid ISO-8601 datetime string",
    ),
    photo_url: z.url("Photo must be a valid URL").max(500, "Photo URL is too long").optional(),

    // Only imports provide NIS directly; normal creates generate it.
    nis: z
      .string()
      .refine((val) => NIS_REGEX.test(val), NIS_MESSAGE)
      .optional(),
    // Preserve legacy NIS values that do not match the current format.
    legacy_nis: z.string().max(50, "Legacy NIS is too long").optional(),
    nisn: z
      .string()
      .regex(NISN_REGEX, NISN_MESSAGE)
      .optional(),
    // Preserve legacy NISN values that do not match the current format.
    legacy_nisn: z.string().max(50, "Legacy NISN is too long").optional(),
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

    // Legacy imports may create terminal student records.
    graduation_grade: z
      .string()
      .max(25, "Graduation grade is too long")
      .optional(),
    leave_year: z.string().max(10, "Leave year is too long").optional(),
    sn: z.boolean().optional(),
    override_too_far_ahead_reason: z
      .string()
      .min(10, "Explain why this grade skip is real (at least 10 characters)")
      .max(300, "Reason is too long")
      .optional(),
    // Set only by the import pipeline.
    import_defaulted_fields: z.array(z.string()).optional(),
    })
    .refine(
      (data) =>
        data.status !== StudentStatus.GRADUATED ||
        (!!data.leave_year && !!data.graduation_grade),
      {
        message: "Graduated students require leave_year and graduation_grade",
        path: ["leave_year"],
      },
    )
    .refine((data) => isBirthDateNotFuture(data.birth_date), {
      message: "Birth date cannot be in the future",
      path: ["birth_date"],
    })
    .refine((data) => isBirthDateNotTooOld(data.birth_date), {
      message: "Birth date is too far in the past to be valid",
      path: ["birth_date"],
    });

  static readonly UPDATE = z
    .object({
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
    religion_other: z.string().max(50, "Religion detail is too long").nullable().optional(),

    birth_place: z
      .string()
      .min(1, "Birth place is required")
      .max(25, "Birth place too long")
      .optional(),
    birth_date: z.iso
      .datetime("Birth date must be a valid ISO-8601 datetime string")
      .optional(),
    photo_url: z.url("Photo must be a valid URL").max(500, "Photo URL is too long").optional(),

    // NIS is immutable after creation.
    nisn: z
      .string()
      .regex(NISN_REGEX, NISN_MESSAGE)
      .optional(),
    legacy_nisn: z.string().max(50, "Legacy NISN is too long").optional(),
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
    sn: z.boolean().optional(),
    // Entry type affects future NIS reissue, not the current NIS.
    entry_type: z
      .enum(STUDENT_ENTRY_TYPE_VALUES, {
        message: "Entry type must be a valid format",
      })
      .optional(),
    pickup_drop_service: z.boolean().optional(),
    catering_service: z.boolean().optional(),
    psb_guide: z.boolean().optional(),
  })
    .refine(
      (data) => !data.birth_date || isBirthDateNotFuture(data.birth_date),
      { message: "Birth date cannot be in the future", path: ["birth_date"] },
    )
    .refine(
      (data) => !data.birth_date || isBirthDateNotTooOld(data.birth_date),
      {
        message: "Birth date is too far in the past to be valid",
        path: ["birth_date"],
      },
    );

  static readonly GET_BACKFILL_CANDIDATES = z.object({
    academic_year_id: z.string().min(1, "Academic year ID is required"),
    grade_id: z.string().min(1, "Grade ID is required"),
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(100),
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

  // NIS reissue requires an explicit entry type.
  static readonly REISSUE_NIS = z.object({
    id: z.string().min(1, "Student internal ID is required"),
    entry_type: z.enum(STUDENT_ENTRY_TYPE_VALUES, {
      message: "Entry type is required and must be a valid format",
    }),
    // Join grade and year may be corrected before deriving the new prefix.
    join_grade_id: z.string().min(1).optional(),
    join_academic_year_id: z.string().min(1).optional(),
  });
}
