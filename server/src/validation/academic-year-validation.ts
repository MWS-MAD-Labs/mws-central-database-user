import { z } from "zod";
import { AcademicYearStatus } from "../generated/prisma/client";
import { ACADEMIC_YEAR_SORT_FIELDS } from "../model/academic-year-model";

const ACADEMIC_YEAR_STATUS_VALUES = Object.keys(AcademicYearStatus) as [
  keyof typeof AcademicYearStatus,
  ...(keyof typeof AcademicYearStatus)[],
];

export class AcademicYearValidation {
  static readonly CREATE = z
    .object({
      name: z
        .string()
        .min(1, "Name is required")
        .max(50, "Name is too long"),
      start_date: z.iso
        .datetime("Start date must be a valid ISO-8601 datetime string")
        .optional(),
      end_date: z.iso
        .datetime("End date must be a valid ISO-8601 datetime string")
        .optional(),
      status: z
        .enum(ACADEMIC_YEAR_STATUS_VALUES, {
          message: "Status must be a valid format",
        })
        .optional(),
    })
    .refine(
      (data) =>
        !data.start_date ||
        !data.end_date ||
        new Date(data.start_date) < new Date(data.end_date),
      {
        message: "start_date must be before end_date",
        path: ["end_date"],
      },
    );

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Academic year ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(50, "Name is too long")
      .optional(),
    start_date: z.iso
      .datetime("Start date must be a valid ISO-8601 datetime string")
      .optional(),
    end_date: z.iso
      .datetime("End date must be a valid ISO-8601 datetime string")
      .optional(),
    status: z
      .enum(ACADEMIC_YEAR_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Academic year ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    status: z.enum(ACADEMIC_YEAR_STATUS_VALUES).optional(),
    sort_by: z.enum(ACADEMIC_YEAR_SORT_FIELDS).default("start_date").optional(),
    sort_order: z.enum(["asc", "desc"]).default("desc").optional(),
  });
}
