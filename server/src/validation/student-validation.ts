import { z } from "zod";
import { Gender, Religion, StudentStatus } from "../generated/prisma/client";

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

    nis: z
      .string()
      .min(1, "NIS is required")
      .max(20, "NIS is too long"),
    nisn: z
      .string()
      .regex(/^\d{10}$/, "NISN must be exactly 10 digits")
      .optional(),
    status: z
      .enum(STUDENT_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    current_grade_id: z
      .string()
      .min(1, "Current grade ID is required"),
    join_academic_year_id: z
      .string()
      .min(1, "Join academic year ID is required"),
    join_grade_id: z
      .string()
      .min(1, "Join grade ID is required"),
    previous_school: z
      .string()
      .max(100, "Previous school is too long")
      .optional(),
  });
}
