import { z } from "zod";
import { LIMITS } from "../constants/limits";
import { PCDay } from "../generated/prisma/client";
import { PC_ACTIVITY_MASTER_SORT_FIELDS } from "../model/pc-activity-model";

export const PC_DAY_VALUES = Object.keys(PCDay) as [
  keyof typeof PCDay,
  ...(keyof typeof PCDay)[],
];

export class PCActivityValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    day: z.enum(PC_DAY_VALUES, { message: "Day must be a valid format" }),
    activity_id: z.string().min(1, "PC Activity ID is required"),
    academic_year_id: z
      .string()
      .min(1, "Academic year ID cannot be an empty string")
      .optional(),
    // Set only when created through a room's bulk-assign flow.
    room_id: z
      .string()
      .min(1, "Room ID cannot be an empty string")
      .optional(),
    start_date: z.iso.datetime().optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    activity_id: z.string().min(1, "PC Activity ID is required").optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly RESTORE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET_LIST = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    is_deleted: z.boolean().default(false).optional(),
  });
}

export class PCActivityMasterValidation {
  static readonly CREATE = z.object({
    name: z.string().min(1, "Name is required").max(LIMITS.MASTER_NAME_MAX, `Name can have up to ${LIMITS.MASTER_NAME_MAX} characters`),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(LIMITS.MASTER_NAME_MAX, `Name can have up to ${LIMITS.MASTER_NAME_MAX} characters`)
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "PC activity ID is required"),
  });

  static readonly SEARCH = z.object({
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
    search: z.string().optional(),
    sort_by: z.enum(PC_ACTIVITY_MASTER_SORT_FIELDS).default("name").optional(),
    sort_order: z.enum(["asc", "desc"]).default("asc").optional(),
  });
}
