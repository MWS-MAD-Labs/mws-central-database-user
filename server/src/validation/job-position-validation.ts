import { z } from "zod";
import { JOB_POSITION_SORT_FIELDS } from "../model/job-position-model";

const CAPACITY_FIELDS = {
  capacity_scope: z.enum(["PER_UNIT", "GLOBAL"]).nullish(),
  max_active_holders: z.number().int().positive().nullish(),
};

function capacityPairIsValid(data: {
  capacity_scope?: string | null;
  max_active_holders?: number | null;
}) {
  return Boolean(data.capacity_scope) === Boolean(data.max_active_holders);
}

export class JobPositionValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    is_teaching_position: z.boolean().optional(),
    unit_ids: z.array(z.string().min(1)).optional(),
    ...CAPACITY_FIELDS,
  }).refine(capacityPairIsValid, {
    message: "Capacity scope and maximum active holders must be set together",
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Job position ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name is too long")
      .optional(),
    is_teaching_position: z.boolean().optional(),
    unit_ids: z.array(z.string().min(1)).optional(),
    ...CAPACITY_FIELDS,
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Job position ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    sort_by: z.enum(JOB_POSITION_SORT_FIELDS).default("name").optional(),
    sort_order: z.enum(["asc", "desc"]).default("asc").optional(),
  });

  static readonly PREVIEW_REASSIGNMENT = z.object({
    id: z.string().min(1, "Job position ID is required"),
    unit_ids: z.array(z.string().min(1)),
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
  });
}
