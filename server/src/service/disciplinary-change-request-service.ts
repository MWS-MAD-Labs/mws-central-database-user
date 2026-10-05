import { randomUUID } from "crypto";
import {
  AuditAction,
  AuditSource,
  IdentifierChangeRequestStatus,
  type AdminUser,
  type IdentifierChangeRequest,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { MINIO_BUCKET, ensureBucketExists, minioClient } from "../lib/minio";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import { toDisciplinaryActionAttachmentAuditSnapshot } from "../model/disciplinary-action-attachment-model";
import { DisciplinaryActionValidation } from "../validation/disciplinary-action-validation";
import { Validation } from "../validation/validation";
import { CheckExist } from "../utils/check-exist";
import { assertCanWriteUnit } from "../utils/admin-permissions";
import {
  assertValidAttachmentFile,
  sanitizeAttachmentFileName,
  sanitizeAttachmentMetadataValue,
} from "../utils/file-attachment";
import {
  hasActiveApprover,
  NO_APPROVER_MESSAGE,
} from "../utils/change-request-approver";
import { AuditService } from "./audit-service";
import {
  assertCanManage,
  canEditDisciplinaryDirectly,
} from "./disciplinary-action-service";

export const DISCIPLINARY_ENTITY_TYPE = "DisciplinaryAction";
const MAX_PENDING_UPLOADS_PER_ACTION = 5;

type RequestRow = {
  field_name: string;
  old_value: string | null;
  new_value: string;
};

async function loadAction(actionId: string, employeeId: string) {
  const action = await prismaClient.employeeDisciplinaryAction.findFirst({
    where: { id: actionId, employee_id: employeeId },
  });
  if (!action) throw new ResponseError(404, "Disciplinary action not found");
  return action;
}

// Common checks before filing anything: write access and unit scope, office
// hours, no direct-edit rights, and someone who can actually decide.
async function assertCanFileRequest(
  admin: AdminUser,
  employeeId: string,
  label: string,
  context: AuditRequestContext,
  now: Date,
  actionId: string,
) {
  const employee = await CheckExist.checkEmployeeExists(employeeId);
  await assertCanManage(admin, employee.unit_id, label, context, now, actionId);
  if (await canEditDisciplinaryDirectly(admin)) {
    throw new ResponseError(
      400,
      "You can edit this letter directly, no request needed.",
    );
  }
  if (!(await hasActiveApprover(DISCIPLINARY_ENTITY_TYPE))) {
    throw new ResponseError(400, NO_APPROVER_MESSAGE);
  }
  return employee;
}

async function createRows(
  admin: AdminUser,
  actionId: string,
  rows: RequestRow[],
  changeReason: string,
  context: AuditRequestContext,
): Promise<string[]> {
  const pending = await prismaClient.identifierChangeRequest.findMany({
    where: {
      entity_type: DISCIPLINARY_ENTITY_TYPE,
      entity_id: actionId,
      status: IdentifierChangeRequestStatus.PENDING,
    },
    select: { field_name: true, new_value: true },
  });
  for (const row of rows) {
    // An upload is a new file each time, so only the per-letter cap limits it.
    if (row.field_name === "attachment_add") continue;
    const sameItem = (entry: { field_name: string; new_value: string }) =>
      entry.field_name === row.field_name &&
      (row.field_name === "reason" ||
        row.field_name === "notes" ||
        entry.new_value === row.new_value);
    if (pending.some(sameItem)) {
      throw new ResponseError(
        400,
        "There is already a pending change request for this item. Cancel it or wait for a decision first.",
      );
    }
  }

  return prismaClient.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const row of rows) {
      const created = await tx.identifierChangeRequest.create({
        data: {
          entity_type: DISCIPLINARY_ENTITY_TYPE,
          entity_id: actionId,
          field_name: row.field_name,
          old_value: row.old_value,
          new_value: row.new_value,
          reason: changeReason,
          requested_by: admin.id,
        },
      });
      // Letter text stays out of the audit row.
      await AuditService.record(
        {
          action: AuditAction.REQUEST_IDENTIFIER_CHANGE,
          source: AuditSource.UI,
          entity_type: "IdentifierChangeRequest",
          entity_id: created.id,
          admin_id: admin.id,
          new_values: {
            target_entity_type: DISCIPLINARY_ENTITY_TYPE,
            target_entity_id: actionId,
            field_name: row.field_name,
            reason: changeReason,
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      ids.push(created.id);
    }
    return ids;
  });
}

export class DisciplinaryChangeRequestService {
  // Reason and/or notes of a saved letter. One request per changed field.
  static async requestEdit(
    admin: AdminUser,
    request: {
      id: string;
      employee_id: string;
      reason?: string;
      notes?: string;
      change_reason: string;
    },
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<{ request_ids: string[] }> {
    const input = Validation.validate(
      DisciplinaryActionValidation.REQUEST_EDIT,
      request,
    );
    await assertCanFileRequest(
      admin,
      input.employee_id,
      "request edit",
      context,
      now,
      input.id,
    );
    const action = await loadAction(input.id, input.employee_id);

    const rows: RequestRow[] = [];
    if (input.reason !== undefined && input.reason !== action.reason) {
      rows.push({ field_name: "reason", old_value: action.reason, new_value: input.reason });
    }
    if (input.notes !== undefined && input.notes !== (action.notes ?? "")) {
      rows.push({ field_name: "notes", old_value: action.notes ?? "", new_value: input.notes });
    }
    if (rows.length === 0) {
      throw new ResponseError(400, "Nothing changed from the saved letter");
    }
    return {
      request_ids: await createRows(admin, action.id, rows, input.change_reason, context),
    };
  }

  // Stages the file (hidden until approved) and files the request for it.
  static async requestAttachmentUpload(
    admin: AdminUser,
    request: { id: string; employee_id: string; change_reason: string },
    file: File,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<{ request_ids: string[] }> {
    const input = Validation.validate(DisciplinaryActionValidation.REQUEST_ATTACHMENT, {
      ...request,
      kind: "add",
    });
    const employee = await assertCanFileRequest(
      admin,
      input.employee_id,
      "request attachment upload",
      context,
      now,
      input.id,
    );
    const action = await loadAction(input.id, input.employee_id);

    const stagedCount = await prismaClient.disciplinaryActionAttachment.count({
      where: { disciplinary_action_id: action.id, pending_approval: true },
    });
    if (stagedCount >= MAX_PENDING_UPLOADS_PER_ACTION) {
      throw new ResponseError(
        400,
        `This letter already has ${MAX_PENDING_UPLOADS_PER_ACTION} uploads waiting for approval.`,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedMimeType = assertValidAttachmentFile(buffer);
    const safeFileName = sanitizeAttachmentFileName(file.name);
    const objectKey = `disciplinary-attachments/${action.id}/${randomUUID()}-${safeFileName}`;

    await ensureBucketExists();
    await minioClient.putObject(MINIO_BUCKET, objectKey, buffer, buffer.length, {
      "Content-Type": detectedMimeType,
      "employee-id": sanitizeAttachmentMetadataValue(employee.employee_id),
      "employee-name": sanitizeAttachmentMetadataValue(employee.person.full_name),
    });

    try {
      const staged = await prismaClient.disciplinaryActionAttachment.create({
        data: {
          disciplinary_action_id: action.id,
          file_name: safeFileName,
          object_key: objectKey,
          file_size: buffer.length,
          mime_type: detectedMimeType,
          uploaded_by: admin.id,
          pending_approval: true,
        },
      });
      const ids = await createRows(
        admin,
        action.id,
        [{ field_name: "attachment_add", old_value: staged.file_name, new_value: staged.id }],
        input.change_reason,
        context,
      );
      return { request_ids: ids };
    } catch (error) {
      await minioClient.removeObject(MINIO_BUCKET, objectKey).catch(() => {});
      await prismaClient.disciplinaryActionAttachment
        .deleteMany({ where: { object_key: objectKey } })
        .catch(() => {});
      throw error;
    }
  }

  static async requestAttachmentChange(
    admin: AdminUser,
    request: {
      id: string;
      employee_id: string;
      attachment_id: string;
      kind: "remove" | "restore";
      change_reason: string;
    },
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<{ request_ids: string[] }> {
    const input = Validation.validate(DisciplinaryActionValidation.REQUEST_ATTACHMENT, request);
    if (!input.attachment_id) {
      throw new ResponseError(400, "Attachment ID is required");
    }
    await assertCanFileRequest(
      admin,
      input.employee_id,
      `request attachment ${input.kind}`,
      context,
      now,
      input.id,
    );
    const action = await loadAction(input.id, input.employee_id);
    const attachment = await prismaClient.disciplinaryActionAttachment.findFirst({
      where: { id: input.attachment_id, disciplinary_action_id: action.id, pending_approval: false },
    });
    if (!attachment) throw new ResponseError(404, "Attachment not found");
    if (input.kind === "remove" && attachment.deleted_at !== null) {
      throw new ResponseError(400, "Attachment is already deleted");
    }
    if (input.kind === "restore" && attachment.deleted_at === null) {
      throw new ResponseError(400, "Attachment is not in the trash bin");
    }
    return {
      request_ids: await createRows(
        admin,
        action.id,
        [
          {
            field_name: input.kind === "remove" ? "attachment_remove" : "attachment_restore",
            old_value: attachment.file_name,
            new_value: attachment.id,
          },
        ],
        input.change_reason,
        context,
      ),
    };
  }

  // Runs when an approver approves. Throws 409 when the letter moved on.
  static async apply(
    admin: AdminUser,
    pending: IdentifierChangeRequest,
    context: AuditRequestContext,
    now: Date,
  ): Promise<void> {
    const action = await prismaClient.employeeDisciplinaryAction.findUnique({
      where: { id: pending.entity_id },
    });
    if (!action) throw new ResponseError(404, "Disciplinary action not found");
    const employee = await CheckExist.checkEmployeeExists(action.employee_id);
    await assertCanWriteUnit(admin, employee.unit_id, "employee");

    const meta = { ip_address: context.ip_address, user_agent: context.user_agent };
    const stale = () =>
      new ResponseError(
        409,
        "This letter changed after the request was made. Reject it and ask for a new request.",
      );

    if (pending.field_name === "reason" || pending.field_name === "notes") {
      const key = pending.field_name;
      const current = key === "reason" ? action.reason : (action.notes ?? "");
      if (current !== (pending.old_value ?? "")) throw stale();
      await prismaClient.$transaction(async (tx) => {
        await tx.employeeDisciplinaryAction.update({
          where: { id: action.id },
          data: { [key]: pending.new_value },
        });
        await AuditService.record(
          {
            action: AuditAction.UPDATE_DISCIPLINARY_ACTION,
            source: AuditSource.UI,
            entity_type: "EmployeeDisciplinaryAction",
            entity_id: action.id,
            admin_id: admin.id,
            old_values: { [key]: pending.old_value },
            new_values: { [key]: pending.new_value, requested_by: pending.requested_by },
            ...meta,
          },
          tx,
        );
      });
      return;
    }

    const attachment = await prismaClient.disciplinaryActionAttachment.findFirst({
      where: { id: pending.new_value, disciplinary_action_id: action.id },
    });
    if (!attachment) throw stale();

    if (pending.field_name === "attachment_add") {
      if (!attachment.pending_approval) throw stale();
      await prismaClient.$transaction(async (tx) => {
        const live = await tx.disciplinaryActionAttachment.update({
          where: { id: attachment.id },
          data: { pending_approval: false },
        });
        await AuditService.record(
          {
            action: AuditAction.UPLOAD_ATTACHMENT,
            source: AuditSource.UI,
            entity_type: "DisciplinaryActionAttachment",
            entity_id: live.id,
            admin_id: admin.id,
            new_values: toDisciplinaryActionAttachmentAuditSnapshot(live),
            ...meta,
          },
          tx,
        );
      });
      return;
    }

    if (attachment.pending_approval) throw stale();
    if (pending.field_name === "attachment_remove") {
      if (attachment.deleted_at !== null) throw stale();
      await prismaClient.$transaction(async (tx) => {
        await tx.disciplinaryActionAttachment.update({
          where: { id: attachment.id },
          data: { deleted_at: now },
        });
        await AuditService.record(
          {
            action: AuditAction.DELETE_ATTACHMENT,
            source: AuditSource.UI,
            entity_type: "DisciplinaryActionAttachment",
            entity_id: attachment.id,
            admin_id: admin.id,
            old_values: toDisciplinaryActionAttachmentAuditSnapshot(attachment),
            new_values: { deleted_at: now.toISOString() },
            ...meta,
          },
          tx,
        );
      });
      return;
    }
    if (pending.field_name === "attachment_restore") {
      if (attachment.deleted_at === null) throw stale();
      await prismaClient.$transaction(async (tx) => {
        await tx.disciplinaryActionAttachment.update({
          where: { id: attachment.id },
          data: { deleted_at: null },
        });
        await AuditService.record(
          {
            action: AuditAction.RESTORE_ATTACHMENT,
            source: AuditSource.UI,
            entity_type: "DisciplinaryActionAttachment",
            entity_id: attachment.id,
            admin_id: admin.id,
            old_values: { deleted_at: attachment.deleted_at!.toISOString() },
            new_values: { deleted_at: null },
            ...meta,
          },
          tx,
        );
      });
      return;
    }
    throw new ResponseError(400, "Unknown disciplinary change request");
  }

  // Rejected or cancelled uploads must not leave the staged file behind.
  static async discard(pending: IdentifierChangeRequest): Promise<void> {
    if (
      pending.entity_type !== DISCIPLINARY_ENTITY_TYPE ||
      pending.field_name !== "attachment_add"
    ) {
      return;
    }
    const staged = await prismaClient.disciplinaryActionAttachment.findFirst({
      where: { id: pending.new_value, pending_approval: true },
    });
    if (!staged) return;
    await minioClient.removeObject(MINIO_BUCKET, staged.object_key).catch(() => {});
    await prismaClient.disciplinaryActionAttachment.delete({ where: { id: staged.id } });
  }
}
