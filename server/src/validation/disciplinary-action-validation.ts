import { z } from "zod";
import { DisciplinaryActionType } from "../generated/prisma/client";

const DISCIPLINARY_ACTION_TYPE_VALUES = Object.keys(
  DisciplinaryActionType,
) as [keyof typeof DisciplinaryActionType, ...(keyof typeof DisciplinaryActionType)[]];

export class DisciplinaryActionValidation {
  static readonly CREATE = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
    type: z.enum(DISCIPLINARY_ACTION_TYPE_VALUES, {
      message: "Type must be SURAT_TEGURAN or SURAT_PERINGATAN",
    }),
    reason: z
      .string()
      .min(1, "Reason is required")
      .max(500, "Reason is too long"),
    notes: z.string().max(1000, "Notes is too long").optional(),
    issued_date: z.iso
      .datetime("Issued date must be a valid ISO-8601 datetime string")
      .optional(),
    validity_days: z
      .number()
      .int("Validity must be a whole number of days")
      .positive("Validity must be greater than zero")
      .max(730, "Validity can't be more than 2 years")
      .optional(),
  });

  static readonly UPDATE = z
    .object({
      id: z.string().min(1, "ID is required"),
      employee_id: z.string().min(1, "Employee ID is required"),
      reason: z
        .string()
        .min(1, "Reason is required")
        .max(500, "Reason is too long")
        .optional(),
      notes: z.string().max(1000, "Notes is too long").optional(),
    })
    .refine((value) => value.reason !== undefined || value.notes !== undefined, {
      message: "Provide at least one of reason or notes to update",
    });

  static readonly RESOLVE = z.object({
    id: z.string().min(1, "ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
    resolved_reason: z
      .string()
      .max(500, "Resolved reason is too long")
      .optional(),
  });

  static readonly REVOKE = z.object({
    id: z.string().min(1, "ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly LIST = z.object({
    employee_id: z.string().min(1, "Employee ID is required"),
    page: z.number().min(1).positive().default(1),
    size: z.number().min(1).positive().max(100).default(10),
  });

  static readonly CHANGE_REASON = z
    .string()
    .trim()
    .min(5, "Reason must be at least 5 characters")
    .max(100, "Reason must be at most 100 characters");

  static readonly REQUEST_EDIT = z
    .object({
      id: z.string().min(1, "ID is required"),
      employee_id: z.string().min(1, "Employee ID is required"),
      reason: z
        .string()
        .min(1, "Reason is required")
        .max(500, "Reason is too long")
        .optional(),
      notes: z.string().max(1000, "Notes is too long").optional(),
      change_reason: DisciplinaryActionValidation.CHANGE_REASON,
    })
    .refine((value) => value.reason !== undefined || value.notes !== undefined, {
      message: "Provide at least one of reason or notes to change",
    });

  static readonly REQUEST_ATTACHMENT = z.object({
    id: z.string().min(1, "ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
    attachment_id: z.string().min(1).optional(),
    kind: z.enum(["add", "remove", "restore"]),
    change_reason: DisciplinaryActionValidation.CHANGE_REASON,
  });
}
