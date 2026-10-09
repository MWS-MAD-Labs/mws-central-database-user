import { z } from "zod";
import { LIMITS } from "../constants/limits";
import { GRADE_SORT_FIELDS } from "../model/grade-model";

export class GradeValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(LIMITS.GRADE_NAME_MAX, `Name can have up to ${LIMITS.GRADE_NAME_MAX} characters`),
    level: z
      .number()
      .int("Level must be a whole number")
      .min(LIMITS.GRADE_LEVEL_MIN, `Level must be ${LIMITS.GRADE_LEVEL_MIN} or more`)
      .max(LIMITS.GRADE_LEVEL_MAX, `Level must be ${LIMITS.GRADE_LEVEL_MAX} or less`),
    unit_id: z.string().min(1, "Unit ID is required").nullish(),
    typical_age: z
      .number()
      .int("Typical age must be a whole number")
      .min(LIMITS.GRADE_AGE_MIN, `Typical age must be ${LIMITS.GRADE_AGE_MIN} or more`)
      .max(LIMITS.GRADE_AGE_MAX, `Typical age must be ${LIMITS.GRADE_AGE_MAX} or less`)
      .nullish(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Grade ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(LIMITS.GRADE_NAME_MAX, `Name can have up to ${LIMITS.GRADE_NAME_MAX} characters`)
      .optional(),
    level: z
      .number()
      .int("Level must be a whole number")
      .min(LIMITS.GRADE_LEVEL_MIN, `Level must be ${LIMITS.GRADE_LEVEL_MIN} or more`)
      .max(LIMITS.GRADE_LEVEL_MAX, `Level must be ${LIMITS.GRADE_LEVEL_MAX} or less`)
      .optional(),
    unit_id: z.string().min(1, "Unit ID is required").nullish(),
    typical_age: z
      .number()
      .int("Typical age must be a whole number")
      .min(LIMITS.GRADE_AGE_MIN, `Typical age must be ${LIMITS.GRADE_AGE_MIN} or more`)
      .max(LIMITS.GRADE_AGE_MAX, `Typical age must be ${LIMITS.GRADE_AGE_MAX} or less`)
      .nullish(),
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
