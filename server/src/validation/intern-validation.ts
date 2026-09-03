import { z } from "zod";
import {
  Gender,
  Religion,
  InternStatus,
  EducationLevel,
} from "../generated/prisma/client";
import { INTERN_SORT_FIELDS } from "../model/intern-model";
import {
  emailWithAllowedDomain,
  indonesianPhone,
  isBirthDateNotFuture,
  isBirthDateNotTooOld,
  isWithinJoinDateFutureCap,
  isWithinReasonableFutureCeiling,
} from "./validation";

const GENDER_VALUES = Object.keys(Gender) as [
  keyof typeof Gender,
  ...(keyof typeof Gender)[],
];

const RELIGION_VALUES = Object.keys(Religion) as [
  keyof typeof Religion,
  ...(keyof typeof Religion)[],
];

const INTERN_STATUS_VALUES = Object.keys(InternStatus) as [
  keyof typeof InternStatus,
  ...(keyof typeof InternStatus)[],
];

const EDUCATION_LEVEL_VALUES = Object.keys(EducationLevel) as [
  keyof typeof EducationLevel,
  ...(keyof typeof EducationLevel)[],
];

const CURRENT_YEAR = new Date().getFullYear();

export class InternValidation {
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
      religion_other: z
        .string()
        .max(50, "Religion detail is too long")
        .nullable()
        .optional(),

      // Not required, unlike Student/Employee's Person - HR doesn't collect
      // these for interns.
      birth_place: z.string().max(25, "Birth place too long").optional(),
      birth_date: z.iso
        .datetime("Birth date must be a valid ISO-8601 datetime string")
        .optional(),

      status: z
        .enum(INTERN_STATUS_VALUES, {
          message: "Status must be a valid format",
        })
        .optional(),

      unit_id: z.string().min(1, "Unit ID is required"),
      job_position_id: z.string().min(1, "Job Position ID is required"),
      building_id: z.string().min(1, "Building ID is required"),

      join_date: z.iso.datetime(
        "Join date must be a valid ISO-8601 datetime string",
      ),
      end_date: z.iso.datetime(
        "End date must be a valid ISO-8601 datetime string",
      ),
      notes: z.string().max(500, "Notes is too long").optional(),

      mobile_phone: indonesianPhone().optional(),
      residential_address: z
        .string()
        .max(255, "Residential address is too long")
        .optional(),

      education_level: z
        .enum(EDUCATION_LEVEL_VALUES, {
          message: "Education level must be a valid format",
        })
        .optional(),
      institution_name: z
        .string()
        .max(150, "Institution name is too long")
        .optional(),
      major: z.string().max(100, "Major is too long").optional(),
      graduation_year: z
        .number()
        .int()
        .min(1980, "Graduation year is invalid")
        .max(CURRENT_YEAR + 10, "Graduation year is too far in the future")
        .optional(),
    })
    .refine((data) => new Date(data.end_date) > new Date(data.join_date), {
      message: "End date must be after join date",
      path: ["end_date"],
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
    )
    .refine((data) => isWithinJoinDateFutureCap(data.join_date), {
      message: "Join date can't be more than 90 days in the future",
      path: ["join_date"],
    })
    .refine((data) => isWithinReasonableFutureCeiling(data.end_date), {
      message: "End date is too far in the future to be valid",
      path: ["end_date"],
    });

  static readonly UPDATE = z
    .object({
      id: z.string().min(1, "Intern internal ID is required"),

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
      religion_other: z
        .string()
        .max(50, "Religion detail is too long")
        .nullable()
        .optional(),

      birth_place: z.string().max(25, "Birth place too long").optional(),
      birth_date: z.iso
        .datetime("Birth date must be a valid ISO-8601 datetime string")
        .optional(),

      status: z
        .enum(INTERN_STATUS_VALUES, {
          message: "Status must be a valid format",
        })
        .optional(),

      unit_id: z.string().min(1).optional(),
      job_position_id: z.string().min(1).optional(),
      building_id: z.string().min(1).optional(),

      join_date: z.iso
        .datetime("Join date must be a valid ISO-8601 datetime string")
        .optional(),
      end_date: z.iso
        .datetime("End date must be a valid ISO-8601 datetime string")
        .optional(),
      notes: z.string().max(500, "Notes is too long").optional(),

      mobile_phone: indonesianPhone().optional(),
      residential_address: z
        .string()
        .max(255, "Residential address is too long")
        .optional(),

      education_level: z
        .enum(EDUCATION_LEVEL_VALUES, {
          message: "Education level must be a valid format",
        })
        .optional(),
      institution_name: z
        .string()
        .max(150, "Institution name is too long")
        .optional(),
      major: z.string().max(100, "Major is too long").optional(),
      graduation_year: z
        .number()
        .int()
        .min(1980, "Graduation year is invalid")
        .max(CURRENT_YEAR + 10, "Graduation year is too far in the future")
        .optional(),
    })
    .refine(
      (data) =>
        !data.join_date ||
        !data.end_date ||
        new Date(data.end_date) > new Date(data.join_date),
      {
        message: "End date must be after join date",
        path: ["end_date"],
      },
    )
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
    )
    .refine(
      (data) => !data.join_date || isWithinJoinDateFutureCap(data.join_date),
      {
        message: "Join date can't be more than 90 days in the future",
        path: ["join_date"],
      },
    )
    .refine(
      (data) => !data.end_date || isWithinReasonableFutureCeiling(data.end_date),
      {
        message: "End date is too far in the future to be valid",
        path: ["end_date"],
      },
    );

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),

    status: z.enum(INTERN_STATUS_VALUES).optional(),
    unit_id: z.string().optional(),
    job_position_id: z.string().optional(),
    building_id: z.string().optional(),
    gender: z.enum(GENDER_VALUES).optional(),
    religion: z.enum(RELIGION_VALUES).optional(),

    join_date_start: z.iso.datetime().optional(),
    join_date_end: z.iso.datetime().optional(),

    is_deleted: z.boolean().default(false).optional(),

    sort_by: z.enum(INTERN_SORT_FIELDS).default("created_at").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });
}
