import { z } from "zod";
import { SIMPLE_MASTER_DATA_SORT_FIELDS } from "../model/simple-master-data-model";

export class SimpleMasterDataValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name is too long")
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    sort_by: z.enum(SIMPLE_MASTER_DATA_SORT_FIELDS).default("name").optional(),
    sort_order: z.enum(["asc", "desc"]).default("asc").optional(),
  });
}
