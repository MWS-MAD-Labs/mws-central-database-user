import type { DisciplinaryActionAttachment } from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export type UploadDisciplinaryActionAttachmentRequest = {
  disciplinary_action_id: string;
  employee_id: string;
};

export type DeleteDisciplinaryActionAttachmentRequest = {
  id: string;
  disciplinary_action_id: string;
  employee_id: string;
};

export type RestoreDisciplinaryActionAttachmentRequest = {
  id: string;
  disciplinary_action_id: string;
  employee_id: string;
};

export type GetDisciplinaryActionAttachmentListRequest = {
  disciplinary_action_id: string;
  employee_id: string;
  is_deleted?: boolean;
};

export type DownloadDisciplinaryActionAttachmentRequest = {
  id: string;
  disciplinary_action_id: string;
  employee_id: string;
};

export type DisciplinaryActionAttachmentResponse = {
  id: string;
  disciplinary_action_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  uploaded_at: string;
  deleted_at: string | null;
  // Short-lived presigned MinIO URL, generated fresh per response - never
  // stored (see resolvePersonPhotoUrl for the same pattern with photos).
  // Lets the frontend render an inline preview instead of forcing a download.
  preview_url: string;
};

export function toDisciplinaryActionAttachmentResponse(
  attachment: DisciplinaryActionAttachment,
  previewUrl: string,
): DisciplinaryActionAttachmentResponse {
  return {
    id: attachment.id,
    disciplinary_action_id: attachment.disciplinary_action_id,
    file_name: attachment.file_name,
    file_size: attachment.file_size,
    mime_type: attachment.mime_type,
    uploaded_by: attachment.uploaded_by,
    uploaded_at: attachment.uploaded_at.toISOString(),
    deleted_at: attachment.deleted_at
      ? attachment.deleted_at.toISOString()
      : null,
    preview_url: previewUrl,
  };
}

export function toDisciplinaryActionAttachmentAuditSnapshot(
  attachment: DisciplinaryActionAttachment,
): AuditValue {
  return {
    disciplinary_action_id: attachment.disciplinary_action_id,
    file_name: attachment.file_name,
    file_size: attachment.file_size,
    mime_type: attachment.mime_type,
    uploaded_by: attachment.uploaded_by,
    deleted_at: attachment.deleted_at
      ? attachment.deleted_at.toISOString()
      : null,
  };
}
