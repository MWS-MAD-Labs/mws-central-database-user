import { z } from "zod";
import { AcademicYearStatus } from "../generated/prisma/client";
import { ACADEMIC_YEAR_SORT_FIELDS } from "../model/academic-year-model";

const ACADEMIC_YEAR_STATUS_VALUES = Object.keys(AcademicYearStatus) as [
  keyof typeof AcademicYearStatus,
  ...(keyof typeof AcademicYearStatus)[],
];

// "YYYY/YYYY+1" only - e.g. "2026/2027". Unlike Class names (which are
// intentionally themed, see academic-class-walkthrough.md), the spec's own
// Academic Year examples never deviate from this format.
const NAME_PATTERN = /^(\d{4})\/(\d{4})$/;

function isConsecutiveYearPair(name: string): boolean {
  const match = name.match(NAME_PATTERN);
  if (!match) return false;
  return Number(match[2]) === Number(match[1]) + 1;
}

const NAME_SCHEMA = z
  .string()
  .regex(NAME_PATTERN, 'Name must be in "YYYY/YYYY" format, e.g. 2026/2027')
  .refine(isConsecutiveYearPair, {
    message: "The second year must be exactly one year after the first",
  });

export class AcademicYearValidation {
  static readonly CREATE = z
    .object({
      name: NAME_SCHEMA,
      start_date: z.iso.datetime(
        "Start date must be a valid ISO-8601 datetime string",
      ),
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
    name: NAME_SCHEMA.optional(),
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
    activate_classes: z.boolean().optional(),
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
