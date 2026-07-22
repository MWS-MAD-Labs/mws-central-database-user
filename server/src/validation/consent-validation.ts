import { z } from "zod";
import { ConsentStatus, ConsentType } from "../generated/prisma/client";

const CONSENT_TYPE_VALUES = Object.keys(ConsentType) as [
  keyof typeof ConsentType,
  ...(keyof typeof ConsentType)[],
];

const CONSENT_STATUS_VALUES = Object.keys(ConsentStatus) as [
  keyof typeof ConsentStatus,
  ...(keyof typeof ConsentStatus)[],
];

export class ConsentValidation {
  static readonly CREATE = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    consent_type: z.enum(CONSENT_TYPE_VALUES, {
      message: "Consent type must be a valid format",
    }),
    status: z
      .enum(CONSENT_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    consent_date: z.iso
      .datetime("Consent date must be a valid ISO-8601 datetime string")
      .optional(),
    signed_by: z.string().max(50, "Signed by is too long").optional(),
    notes: z.string().max(500, "Notes is too long").optional(),
    validity_period: z.iso
      .datetime("Validity period must be a valid ISO-8601 datetime string")
      .optional(),
  });

  static readonly UPDATE = z.object({
    id: z.string().min(1, "Consent record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    status: z
      .enum(CONSENT_STATUS_VALUES, {
        message: "Status must be a valid format",
      })
      .optional(),
    consent_date: z.iso
      .datetime("Consent date must be a valid ISO-8601 datetime string")
      .optional(),
    signed_by: z.string().max(50, "Signed by is too long").optional(),
    notes: z.string().max(500, "Notes is too long").optional(),
    validity_period: z.iso
      .datetime("Validity period must be a valid ISO-8601 datetime string")
      .optional(),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Consent record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly RESTORE = z.object({
    id: z.string().min(1, "Consent record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET_LIST = z.object({
    student_id: z.string().min(1, "Student ID is required"),
    is_deleted: z.boolean().default(false).optional(),
  });
}
