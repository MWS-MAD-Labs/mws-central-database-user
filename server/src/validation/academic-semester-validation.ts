import { z } from "zod";

const isoDate = (label: string) => z.iso.datetime(`${label} must be a valid ISO-8601 datetime string`);

const NAME = z.string().trim().min(1, "Name is required").max(64, "Name is too long");

export class AcademicSemesterValidation {
  static readonly CREATE = z
    .object({
      academic_year_id: z.string().min(1, "Academic year is required"),
      name: NAME,
      start_date: isoDate("Start date"),
      end_date: isoDate("End date"),
    })
    .refine((data) => new Date(data.start_date) <= new Date(data.end_date), {
      message: "The start date cannot be after the end date",
      path: ["end_date"],
    });

  static readonly UPDATE = z
    .object({
      id: z.string().min(1, "Semester is required"),
      name: NAME.optional(),
      start_date: isoDate("Start date").optional(),
      end_date: isoDate("End date").optional(),
    })
    .refine((data) => data.name !== undefined || data.start_date !== undefined || data.end_date !== undefined, {
      message: "Nothing to change",
    });
}
