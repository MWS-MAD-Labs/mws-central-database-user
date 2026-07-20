import { z } from "zod";
import { JOB_LEVEL_SORT_FIELDS } from "../model/job-level-model";

export class JobLevelValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    is_teaching_role: z.boolean().optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Job level ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name is too long")
      .optional(),
    is_teaching_role: z.boolean().optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Job level ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    sort_by: z.enum(JOB_LEVEL_SORT_FIELDS).default("name").optional(),
    sort_order: z.enum(["asc", "desc"]).default("asc").optional(),
  });
}
