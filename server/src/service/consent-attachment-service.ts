import { randomUUID } from "crypto";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { MINIO_BUCKET, ensureBucketExists, minioClient } from "../lib/minio";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toConsentAttachmentAuditSnapshot,
  toConsentAttachmentResponse,
  type ConsentAttachmentResponse,
  type DeleteConsentAttachmentRequest,
  type DownloadConsentAttachmentRequest,
  type GetConsentAttachmentListRequest,
  type RestoreConsentAttachmentRequest,
  type UploadConsentAttachmentRequest,
} from "../model/consent-attachment-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertCanViewSensitiveData } from "../utils/sensitive-data";
import { ConsentAttachmentValidation } from "../validation/consent-attachment-validation";
import { Validation } from "../validation/validation";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// Magic bytes, not the client-supplied Content-Type, which is trivially spoofable.
const FILE_SIGNATURES: { mimeType: string; bytes: number[] }[] = [
  { mimeType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  {
    mimeType: "image/png",
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
];

function assertWriteAllowed(
  admin: AdminUser,
  context: AuditRequestContext,
  now: Date,
): Promise<void> | void {
  if (admin.role === AdminRole.VIEWER) {
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_data) {
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to modify data",
      );
    }
    return assertCanWriteNow(admin, context, now);
  }
}

async function assertStudentExists(
  studentId: string,
  requireActive = false,
): Promise<void> {
  const student = await prismaClient.student.findFirst({
    where: {
      id: studentId,
      deleted_at: requireActive ? null : undefined,
    },
  });
  if (!student) {
    throw new ResponseError(404, "Student not found");
  }
}

async function assertConsentExists(
  consentId: string,
  studentId: string,
  requireActive = false,
): Promise<void> {
  const consent = await prismaClient.consentRecord.findFirst({
    where: { id: consentId, student_id: studentId },
  });
  if (!consent) {
    throw new ResponseError(404, "Consent record not found");
  }
  if (requireActive && consent.deleted_at !== null) {
    throw new ResponseError(
      400,
      "Cannot upload an attachment to a deleted consent record. Restore it first.",
    );
  }
}

function detectFileMimeType(buffer: Buffer): string | null {
  const match = FILE_SIGNATURES.find((signature) =>
    signature.bytes.every((byte, index) => buffer[index] === byte),
  );
  return match?.mimeType ?? null;
}

// Returns the file's real mime type, detected from its content - not whatever
// Content-Type the client claimed.
function assertValidFile(buffer: Buffer): string {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new ResponseError(
      400,
      `File is too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
    );
  }

  const detectedMimeType = detectFileMimeType(buffer);
  if (!detectedMimeType) {
    throw new ResponseError(
      400,
      "Unsupported or unrecognized file type. Allowed types: PDF, JPEG, PNG.",
    );
  }

  return detectedMimeType;
}

// Strips path separators and anything outside a safe charset, so the
// original filename can't inject path segments into the MinIO object key.
function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  return cleaned || "file";
}

// HTTP header values must stay ASCII-safe - this is display-only console
// context anyway, the DB relation is the actual source of truth.
function sanitizeMetadataValue(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "").slice(0, 100);
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class ConsentAttachmentService {
  static async upload(
    admin: AdminUser,
    request: UploadConsentAttachmentRequest,
    file: File,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ConsentAttachmentResponse> {
    await assertWriteAllowed(admin, context, now);
    await assertCanViewSensitiveData(admin, context);

    const uploadRequest = Validation.validate(
      ConsentAttachmentValidation.UPLOAD,
      request,
    );

    await assertStudentExists(uploadRequest.student_id, true);
    await assertConsentExists(
      uploadRequest.consent_id,
      uploadRequest.student_id,
      true,
    );

    // Not part of the object key (that stays stable/opaque) - just console-visible
    // context so an admin browsing MinIO directly can tell whose file this is.
    const student = await prismaClient.student.findUniqueOrThrow({
      where: { id: uploadRequest.student_id },
      include: { person: true },
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedMimeType = assertValidFile(buffer);
    const safeFileName = sanitizeFileName(file.name);
    const objectKey = `consent-attachments/${uploadRequest.consent_id}/${randomUUID()}-${safeFileName}`;

    await ensureBucketExists();
    await minioClient.putObject(MINIO_BUCKET, objectKey, buffer, buffer.length, {
      "Content-Type": detectedMimeType,
      "student-nis": sanitizeMetadataValue(student.nis),
      "student-name": sanitizeMetadataValue(student.person.full_name),
    });

    let created;
    try {
      created = await prismaClient.consentAttachment.create({
        data: {
          consent_id: uploadRequest.consent_id,
          file_name: safeFileName,
          object_key: objectKey,
          file_size: buffer.length,
          mime_type: detectedMimeType,
          uploaded_by: admin.id,
        },
      });
    } catch (error) {
      // DB write failed after the MinIO write succeeded - remove the orphaned object.
      await minioClient.removeObject(MINIO_BUCKET, objectKey).catch(() => {});
      throw error;
    }

    await AuditService.record({
      action: AuditAction.UPLOAD_ATTACHMENT,
      source: AuditSource.UI,
      entity_type: "ConsentAttachment",
      entity_id: created.id,
      admin_id: admin.id,
      new_values: toConsentAttachmentAuditSnapshot(created),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toConsentAttachmentResponse(created);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteConsentAttachmentRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete consent attachments",
      );
    }

    const deleteRequest = Validation.validate(
      ConsentAttachmentValidation.DELETE,
      request,
    );

    await assertConsentExists(deleteRequest.consent_id, deleteRequest.student_id);

    const existing = await prismaClient.consentAttachment.findFirst({
      where: { id: deleteRequest.id, consent_id: deleteRequest.consent_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Attachment not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "Attachment is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.consentAttachment.update({
      where: { id: existing.id },
      data: { deleted_at: deletedAt },
    });

    await AuditService.record({
      action: AuditAction.DELETE_ATTACHMENT,
      source: AuditSource.UI,
      entity_type: "ConsentAttachment",
      entity_id: existing.id,
      admin_id: admin.id,
      old_values: toConsentAttachmentAuditSnapshot(existing),
      new_values: { deleted_at: deletedAt.toISOString() },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return true;
  }

  static async restore(
    admin: AdminUser,
    request: RestoreConsentAttachmentRequest,
    context: AuditRequestContext = {},
  ): Promise<ConsentAttachmentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore consent attachments",
      );
    }

    const restoreRequest = Validation.validate(
      ConsentAttachmentValidation.RESTORE,
      request,
    );

    await assertConsentExists(
      restoreRequest.consent_id,
      restoreRequest.student_id,
    );

    const existing = await prismaClient.consentAttachment.findFirst({
      where: { id: restoreRequest.id, consent_id: restoreRequest.consent_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Attachment not found");
    }
    if (existing.deleted_at === null) {
      throw new ResponseError(
        400,
        "Attachment is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    const restored = await prismaClient.consentAttachment.update({
      where: { id: existing.id },
      data: { deleted_at: null },
    });

    await AuditService.record({
      action: AuditAction.RESTORE_ATTACHMENT,
      source: AuditSource.UI,
      entity_type: "ConsentAttachment",
      entity_id: restored.id,
      admin_id: admin.id,
      old_values: { deleted_at: existing.deleted_at.toISOString() },
      new_values: { deleted_at: null },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toConsentAttachmentResponse(restored);
  }

  static async getList(
    admin: AdminUser,
    request: GetConsentAttachmentListRequest,
    context: AuditRequestContext = {},
  ): Promise<ConsentAttachmentResponse[]> {
    await assertCanViewSensitiveData(admin, context);

    const listRequest = Validation.validate(
      ConsentAttachmentValidation.GET_LIST,
      request,
    );

    await assertStudentExists(listRequest.student_id);
    await assertConsentExists(listRequest.consent_id, listRequest.student_id);

    const attachments = await prismaClient.consentAttachment.findMany({
      where: {
        consent_id: listRequest.consent_id,
        deleted_at: listRequest.is_deleted ? { not: null } : null,
      },
      orderBy: { uploaded_at: "desc" },
    });

    return attachments.map(toConsentAttachmentResponse);
  }

  static async download(
    admin: AdminUser,
    request: DownloadConsentAttachmentRequest,
    context: AuditRequestContext = {},
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    await assertCanViewSensitiveData(admin, context);

    const downloadRequest = Validation.validate(
      ConsentAttachmentValidation.DOWNLOAD,
      request,
    );

    await assertConsentExists(
      downloadRequest.consent_id,
      downloadRequest.student_id,
    );

    const attachment = await prismaClient.consentAttachment.findFirst({
      where: {
        id: downloadRequest.id,
        consent_id: downloadRequest.consent_id,
        deleted_at: null,
      },
    });
    if (!attachment) {
      throw new ResponseError(404, "Attachment not found");
    }

    const stream = await minioClient.getObject(
      MINIO_BUCKET,
      attachment.object_key,
    );
    const buffer = await streamToBuffer(stream);

    await AuditService.record({
      action: AuditAction.DOWNLOAD_ATTACHMENT,
      source: AuditSource.UI,
      entity_type: "ConsentAttachment",
      entity_id: attachment.id,
      admin_id: admin.id,
      new_values: toConsentAttachmentAuditSnapshot(attachment),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      buffer,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
    };
  }
}
