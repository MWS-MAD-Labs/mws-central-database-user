import { z } from "zod";

export class DisciplinaryActionAttachmentValidation {
  static readonly UPLOAD = z.object({
    disciplinary_action_id: z.string().min(1, "Disciplinary action ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly DELETE = z.object({
    id: z.string().min(1, "Attachment ID is required"),
    disciplinary_action_id: z.string().min(1, "Disciplinary action ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly RESTORE = z.object({
    id: z.string().min(1, "Attachment ID is required"),
    disciplinary_action_id: z.string().min(1, "Disciplinary action ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly DOWNLOAD = z.object({
    id: z.string().min(1, "Attachment ID is required"),
    disciplinary_action_id: z.string().min(1, "Disciplinary action ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
  });

  static readonly GET_LIST = z.object({
    disciplinary_action_id: z.string().min(1, "Disciplinary action ID is required"),
    employee_id: z.string().min(1, "Employee ID is required"),
    is_deleted: z.boolean().default(false).optional(),
  });
}
