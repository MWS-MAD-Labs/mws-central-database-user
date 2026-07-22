import type { ConsentAttachment } from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";

export type UploadConsentAttachmentRequest = {
  consent_id: string;
  student_id: string;
};

export type DeleteConsentAttachmentRequest = {
  id: string;
  consent_id: string;
  student_id: string;
};

export type RestoreConsentAttachmentRequest = {
  id: string;
  consent_id: string;
  student_id: string;
};

export type GetConsentAttachmentListRequest = {
  consent_id: string;
  student_id: string;
  is_deleted?: boolean;
};

export type DownloadConsentAttachmentRequest = {
  id: string;
  consent_id: string;
  student_id: string;
};

export type ConsentAttachmentResponse = {
  id: string;
  consent_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  uploaded_at: string;
  deleted_at: string | null;
};

export function toConsentAttachmentResponse(
  attachment: ConsentAttachment,
): ConsentAttachmentResponse {
  return {
    id: attachment.id,
    consent_id: attachment.consent_id,
    file_name: attachment.file_name,
    file_size: attachment.file_size,
    mime_type: attachment.mime_type,
    uploaded_by: attachment.uploaded_by,
    uploaded_at: attachment.uploaded_at.toISOString(),
    deleted_at: attachment.deleted_at
      ? attachment.deleted_at.toISOString()
      : null,
  };
}

export function toConsentAttachmentAuditSnapshot(
  attachment: ConsentAttachment,
): AuditValue {
  return {
    consent_id: attachment.consent_id,
    file_name: attachment.file_name,
    file_size: attachment.file_size,
    mime_type: attachment.mime_type,
    uploaded_by: attachment.uploaded_by,
    deleted_at: attachment.deleted_at
      ? attachment.deleted_at.toISOString()
      : null,
  };
}
