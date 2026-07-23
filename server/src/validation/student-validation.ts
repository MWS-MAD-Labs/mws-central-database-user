import { z } from "zod";
import {
  ConsentStatus,
  Gender,
  PCDay,
  Religion,
  StudentStatus,
} from "../generated/prisma/client";
import { STUDENT_SORT_FIELDS } from "../model/student-model";
import { emailWithAllowedDomain } from "./validation";

const NIS_REGEX = /^\d{7}$/;
const NIS_MESSAGE = "NIS must be exactly 7 digits";

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

    nis: z.string().refine((val) => NIS_REGEX.test(val), NIS_MESSAGE),
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

    nis: z
      .string()
      .refine((val) => NIS_REGEX.test(val), NIS_MESSAGE)
      .optional(),
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
}
