import { z } from "zod";
import { GRADE_SORT_FIELDS } from "../model/grade-model";

export class GradeValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    level: z
      .number()
      .int("Level must be a whole number")
      .min(-10, "Level is too low")
      .max(50, "Level is too high"),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Grade ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name is too long")
      .optional(),
    level: z
      .number()
      .int("Level must be a whole number")
      .min(-10, "Level is too low")
      .max(50, "Level is too high")
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Grade ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    sort_by: z.enum(GRADE_SORT_FIELDS).default("level").optional(),
    sort_order: z.enum(["asc", "desc"]).default("asc").optional(),
  });
}
