import { z } from "zod";

export class ConsentAttachmentValidation {
  static readonly UPLOAD = z.object({
    consent_id: z.string().min(1, "Consent record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Attachment ID is required"),
    consent_id: z.string().min(1, "Consent record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly RESTORE = z.object({
    id: z.string().min(1, "Attachment ID is required"),
    consent_id: z.string().min(1, "Consent record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly DOWNLOAD = z.object({
    id: z.string().min(1, "Attachment ID is required"),
    consent_id: z.string().min(1, "Consent record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
  });

  static readonly GET_LIST = z.object({
    consent_id: z.string().min(1, "Consent record ID is required"),
    student_id: z.string().min(1, "Student ID is required"),
    is_deleted: z.boolean().default(false).optional(),
  });
}
