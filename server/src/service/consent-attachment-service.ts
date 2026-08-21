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
import {
  assertCanViewSensitiveData,
  assertStudentInAdminUnit,
} from "../utils/sensitive-data";
import { ConsentAttachmentValidation } from "../validation/consent-attachment-validation";
import { Validation } from "../validation/validation";
import {
  assertValidAttachmentFile,
  resolveAttachmentPreviewUrl,
  sanitizeAttachmentFileName,
  sanitizeAttachmentMetadataValue,
  streamToBuffer,
} from "../utils/file-attachment";

async function recordUnauthorizedConsentAttachmentAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  studentId?: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: `blocked consent attachment ${action}`,
      ...(studentId ? { student_id: studentId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

async function assertWriteAllowed(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  now: Date,
  studentId?: string,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    await recordUnauthorizedConsentAttachmentAction(
      admin,
      action,
      context,
      studentId,
    );
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_data) {
      await recordUnauthorizedConsentAttachmentAction(
        admin,
        action,
        context,
        studentId,
      );
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to modify data",
      );
    }
    if (!admin.can_write_student_data) {
      await recordUnauthorizedConsentAttachmentAction(
        admin,
        action,
        context,
        studentId,
      );
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write student data",
      );
    }
    await assertCanWriteNow(admin, context, now);
    if (studentId) {
      await assertStudentInAdminUnit(admin, studentId, context);
    }
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

export class ConsentAttachmentService {
  static async upload(
    admin: AdminUser,
    request: UploadConsentAttachmentRequest,
    file: File,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ConsentAttachmentResponse> {
    await assertWriteAllowed(
      admin,
      "upload",
      context,
      now,
      request.student_id,
    );
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
    const detectedMimeType = assertValidAttachmentFile(buffer);
    const safeFileName = sanitizeAttachmentFileName(file.name);
    const objectKey = `consent-attachments/${uploadRequest.consent_id}/${randomUUID()}-${safeFileName}`;

    await ensureBucketExists();
    await minioClient.putObject(MINIO_BUCKET, objectKey, buffer, buffer.length, {
      "Content-Type": detectedMimeType,
      "student-nis": sanitizeAttachmentMetadataValue(
        student.nis ?? student.legacy_nis ?? "unassigned",
      ),
      "student-name": sanitizeAttachmentMetadataValue(student.person.full_name),
    });

    let created;
    try {
      created = await prismaClient.$transaction(async (tx) => {
        const newAttachment = await tx.consentAttachment.create({
          data: {
            consent_id: uploadRequest.consent_id,
            file_name: safeFileName,
            object_key: objectKey,
            file_size: buffer.length,
            mime_type: detectedMimeType,
            uploaded_by: admin.id,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.UPLOAD_ATTACHMENT,
            source: AuditSource.UI,
            entity_type: "ConsentAttachment",
            entity_id: newAttachment.id,
            admin_id: admin.id,
            new_values: toConsentAttachmentAuditSnapshot(newAttachment),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newAttachment;
      });
    } catch (error) {
      // DB write or audit write failed after the MinIO write succeeded -
      // remove the orphaned object.
      await minioClient.removeObject(MINIO_BUCKET, objectKey).catch(() => {});
      throw error;
    }

    const previewUrl = await resolveAttachmentPreviewUrl(created.object_key);
    return toConsentAttachmentResponse(created, previewUrl);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteConsentAttachmentRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedConsentAttachmentAction(
        admin,
        "delete",
        context,
        request.student_id,
      );
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
    await prismaClient.$transaction(async (tx) => {
      await tx.consentAttachment.update({
        where: { id: existing.id },
        data: { deleted_at: deletedAt },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_ATTACHMENT,
          source: AuditSource.UI,
          entity_type: "ConsentAttachment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toConsentAttachmentAuditSnapshot(existing),
          new_values: { deleted_at: deletedAt.toISOString() },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return true;
  }

  static async restore(
    admin: AdminUser,
    request: RestoreConsentAttachmentRequest,
    context: AuditRequestContext = {},
  ): Promise<ConsentAttachmentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedConsentAttachmentAction(
        admin,
        "restore",
        context,
        request.student_id,
      );
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

    const restored = await prismaClient.$transaction(async (tx) => {
      const restoredAttachment = await tx.consentAttachment.update({
        where: { id: existing.id },
        data: { deleted_at: null },
      });

      await AuditService.record(
        {
          action: AuditAction.RESTORE_ATTACHMENT,
          source: AuditSource.UI,
          entity_type: "ConsentAttachment",
          entity_id: restoredAttachment.id,
          admin_id: admin.id,
          old_values: {
            // deleted_at !== null already checked above - TS narrowing
            // doesn't cross this closure boundary, hence the assertion.
            deleted_at: existing.deleted_at!.toISOString(),
          },
          new_values: { deleted_at: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return restoredAttachment;
    });

    const previewUrl = await resolveAttachmentPreviewUrl(restored.object_key);
    return toConsentAttachmentResponse(restored, previewUrl);
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

    return Promise.all(
      attachments.map(async (attachment) => {
        const previewUrl = await resolveAttachmentPreviewUrl(attachment.object_key);
        return toConsentAttachmentResponse(attachment, previewUrl);
      }),
    );
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
