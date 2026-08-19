import { randomUUID } from "crypto";
import { AuditAction, AuditSource, type AdminUser } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { MINIO_BUCKET, ensureBucketExists, minioClient } from "../lib/minio";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toDisciplinaryActionAttachmentAuditSnapshot,
  toDisciplinaryActionAttachmentResponse,
  type DeleteDisciplinaryActionAttachmentRequest,
  type DisciplinaryActionAttachmentResponse,
  type DownloadDisciplinaryActionAttachmentRequest,
  type GetDisciplinaryActionAttachmentListRequest,
  type RestoreDisciplinaryActionAttachmentRequest,
  type UploadDisciplinaryActionAttachmentRequest,
} from "../model/disciplinary-action-attachment-model";
import { AuditService } from "./audit-service";
import { CheckExist } from "../utils/check-exist";
import { assertCanManage } from "./disciplinary-action-service";
import {
  assertValidAttachmentFile,
  resolveAttachmentPreviewUrl,
  sanitizeAttachmentFileName,
  sanitizeAttachmentMetadataValue,
  streamToBuffer,
} from "../utils/file-attachment";
import { DisciplinaryActionAttachmentValidation } from "../validation/disciplinary-action-attachment-validation";
import { Validation } from "../validation/validation";

async function assertDisciplinaryActionExists(
  disciplinaryActionId: string,
  employeeId: string,
) {
  const action = await prismaClient.employeeDisciplinaryAction.findFirst({
    where: { id: disciplinaryActionId, employee_id: employeeId },
  });
  if (!action) {
    throw new ResponseError(404, "Disciplinary action not found");
  }
  return action;
}

export class DisciplinaryActionAttachmentService {
  static async upload(
    admin: AdminUser,
    request: UploadDisciplinaryActionAttachmentRequest,
    file: File,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<DisciplinaryActionAttachmentResponse> {
    const uploadRequest = Validation.validate(
      DisciplinaryActionAttachmentValidation.UPLOAD,
      request,
    );

    const employee = await CheckExist.checkEmployeeExists(
      uploadRequest.employee_id,
    );
    await assertCanManage(
      admin,
      employee.unit_id,
      "upload attachment",
      context,
      now,
      uploadRequest.disciplinary_action_id,
    );
    await assertDisciplinaryActionExists(
      uploadRequest.disciplinary_action_id,
      uploadRequest.employee_id,
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedMimeType = assertValidAttachmentFile(buffer);
    const safeFileName = sanitizeAttachmentFileName(file.name);
    const objectKey = `disciplinary-attachments/${uploadRequest.disciplinary_action_id}/${randomUUID()}-${safeFileName}`;

    await ensureBucketExists();
    await minioClient.putObject(MINIO_BUCKET, objectKey, buffer, buffer.length, {
      "Content-Type": detectedMimeType,
      "employee-id": sanitizeAttachmentMetadataValue(employee.employee_id),
      "employee-name": sanitizeAttachmentMetadataValue(
        employee.person.full_name,
      ),
    });

    let created;
    try {
      created = await prismaClient.$transaction(async (tx) => {
        const newAttachment = await tx.disciplinaryActionAttachment.create({
          data: {
            disciplinary_action_id: uploadRequest.disciplinary_action_id,
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
            entity_type: "DisciplinaryActionAttachment",
            entity_id: newAttachment.id,
            admin_id: admin.id,
            new_values: toDisciplinaryActionAttachmentAuditSnapshot(newAttachment),
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
    return toDisciplinaryActionAttachmentResponse(created, previewUrl);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteDisciplinaryActionAttachmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    const deleteRequest = Validation.validate(
      DisciplinaryActionAttachmentValidation.DELETE,
      request,
    );

    const employee = await CheckExist.checkEmployeeExists(
      deleteRequest.employee_id,
    );
    await assertCanManage(
      admin,
      employee.unit_id,
      "delete attachment",
      context,
      now,
      deleteRequest.id,
    );
    await assertDisciplinaryActionExists(
      deleteRequest.disciplinary_action_id,
      deleteRequest.employee_id,
    );

    const existing = await prismaClient.disciplinaryActionAttachment.findFirst({
      where: {
        id: deleteRequest.id,
        disciplinary_action_id: deleteRequest.disciplinary_action_id,
      },
    });
    if (!existing) {
      throw new ResponseError(404, "Attachment not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "Attachment is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.$transaction(async (tx) => {
      await tx.disciplinaryActionAttachment.update({
        where: { id: existing.id },
        data: { deleted_at: deletedAt },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_ATTACHMENT,
          source: AuditSource.UI,
          entity_type: "DisciplinaryActionAttachment",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toDisciplinaryActionAttachmentAuditSnapshot(existing),
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
    request: RestoreDisciplinaryActionAttachmentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<DisciplinaryActionAttachmentResponse> {
    const restoreRequest = Validation.validate(
      DisciplinaryActionAttachmentValidation.RESTORE,
      request,
    );

    const employee = await CheckExist.checkEmployeeExists(
      restoreRequest.employee_id,
    );
    await assertCanManage(
      admin,
      employee.unit_id,
      "restore attachment",
      context,
      now,
      restoreRequest.id,
    );
    await assertDisciplinaryActionExists(
      restoreRequest.disciplinary_action_id,
      restoreRequest.employee_id,
    );

    const existing = await prismaClient.disciplinaryActionAttachment.findFirst({
      where: {
        id: restoreRequest.id,
        disciplinary_action_id: restoreRequest.disciplinary_action_id,
      },
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
      const restoredAttachment = await tx.disciplinaryActionAttachment.update({
        where: { id: existing.id },
        data: { deleted_at: null },
      });

      await AuditService.record(
        {
          action: AuditAction.RESTORE_ATTACHMENT,
          source: AuditSource.UI,
          entity_type: "DisciplinaryActionAttachment",
          entity_id: restoredAttachment.id,
          admin_id: admin.id,
          old_values: {
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
    return toDisciplinaryActionAttachmentResponse(restored, previewUrl);
  }

  static async getList(
    admin: AdminUser,
    request: GetDisciplinaryActionAttachmentListRequest,
  ): Promise<DisciplinaryActionAttachmentResponse[]> {
    const listRequest = Validation.validate(
      DisciplinaryActionAttachmentValidation.GET_LIST,
      request,
    );

    const employee = await CheckExist.checkEmployeeExists(
      listRequest.employee_id,
    );
    // Read-only - mirrors DisciplinaryActionService.list()'s unit-scope
    // check, no separate write-permission gate for viewing.
    if (
      admin.role === "DATABASE_ADMIN" &&
      !admin.can_view_all_units &&
      employee.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(404, "Employee not found");
    }
    await assertDisciplinaryActionExists(
      listRequest.disciplinary_action_id,
      listRequest.employee_id,
    );

    const attachments = await prismaClient.disciplinaryActionAttachment.findMany({
      where: {
        disciplinary_action_id: listRequest.disciplinary_action_id,
        deleted_at: listRequest.is_deleted ? { not: null } : null,
      },
      orderBy: { uploaded_at: "desc" },
    });

    return Promise.all(
      attachments.map(async (attachment) => {
        const previewUrl = await resolveAttachmentPreviewUrl(attachment.object_key);
        return toDisciplinaryActionAttachmentResponse(attachment, previewUrl);
      }),
    );
  }

  static async download(
    admin: AdminUser,
    request: DownloadDisciplinaryActionAttachmentRequest,
    context: AuditRequestContext = {},
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const downloadRequest = Validation.validate(
      DisciplinaryActionAttachmentValidation.DOWNLOAD,
      request,
    );

    const employee = await CheckExist.checkEmployeeExists(
      downloadRequest.employee_id,
    );
    if (
      admin.role === "DATABASE_ADMIN" &&
      !admin.can_view_all_units &&
      employee.unit_id !== admin.unit_id
    ) {
      throw new ResponseError(404, "Employee not found");
    }
    await assertDisciplinaryActionExists(
      downloadRequest.disciplinary_action_id,
      downloadRequest.employee_id,
    );

    const attachment = await prismaClient.disciplinaryActionAttachment.findFirst({
      where: {
        id: downloadRequest.id,
        disciplinary_action_id: downloadRequest.disciplinary_action_id,
        deleted_at: null,
      },
    });
    if (!attachment) {
      throw new ResponseError(404, "Attachment not found");
    }

    const stream = await minioClient.getObject(MINIO_BUCKET, attachment.object_key);
    const buffer = await streamToBuffer(stream);

    await AuditService.record({
      action: AuditAction.DOWNLOAD_ATTACHMENT,
      source: AuditSource.UI,
      entity_type: "DisciplinaryActionAttachment",
      entity_id: attachment.id,
      admin_id: admin.id,
      new_values: toDisciplinaryActionAttachmentAuditSnapshot(attachment),
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
