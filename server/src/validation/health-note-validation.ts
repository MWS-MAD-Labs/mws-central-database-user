import { z } from "zod";
import {
  HealthNoteCategory,
  HealthNoteStatus,
} from "../generated/prisma/client";

const HEALTH_NOTE_CATEGORY_VALUES = Object.keys(HealthNoteCategory) as [
  keyof typeof HealthNoteCategory,
  ...(keyof typeof HealthNoteCategory)[],
];

const HEALTH_NOTE_STATUS_VALUES = Object.keys(HealthNoteStatus) as [
  keyof typeof HealthNoteStatus,
  ...(keyof typeof HealthNoteStatus)[],
];

export class HealthNoteValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    category: z.enum(HEALTH_NOTE_CATEGORY_VALUES, {
      message: "Category must be a valid format",
    }),
    description: z
      .string()
      .min(1, "Description is required")
      .max(500, "Description is too long"),
    status: z
      .enum(HEALTH_NOTE_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    noted_date: z.iso
      .datetime("Noted date must be a valid ISO-8601 datetime string")
      .optional(),
    resolved_date: z.iso
      .datetime("Resolved date must be a valid ISO-8601 datetime string")
      .optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Health note ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    category: z
      .enum(HEALTH_NOTE_CATEGORY_VALUES, {
        message: "Category must be a valid format",
      })
      .optional(),
    description: z
      .string()
      .min(1, "Description is required")
      .max(500, "Description is too long")
      .optional(),
    status: z
      .enum(HEALTH_NOTE_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    noted_date: z.iso
      .datetime("Noted date must be a valid ISO-8601 datetime string")
      .optional(),
    resolved_date: z.iso
      .datetime("Resolved date must be a valid ISO-8601 datetime string")
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Health note ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly RESTORE = z.object({
    id: z.string().min(1, "Health note ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET_LIST = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    is_deleted: z.boolean().default(false).optional(),
  });
}
