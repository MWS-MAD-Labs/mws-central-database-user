import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toHealthNoteAuditSnapshot,
  toHealthNoteResponse,
  type CreateHealthNoteRequest,
  type DeleteHealthNoteRequest,
  type GetHealthNoteListRequest,
  type HealthNoteResponse,
  type RestoreHealthNoteRequest,
  type UpdateHealthNoteRequest,
} from "../model/health-note-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertCanViewSensitiveData } from "../utils/sensitive-data";
import { HealthNoteValidation } from "../validation/health-note-validation";
import { Validation } from "../validation/validation";

async function recordUnauthorizedHealthNoteAction(
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
      reason: `blocked health note ${action}`,
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
    await recordUnauthorizedHealthNoteAction(admin, action, context, studentId);
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_data) {
      await recordUnauthorizedHealthNoteAction(admin, action, context, studentId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to modify data",
      );
    }
    await assertCanWriteNow(admin, context, now);
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

async function recordHealthDataAccess(
  admin: AdminUser,
  studentId: string,
  context: AuditRequestContext,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.ACCESS_HEALTH_DATA,
    source: AuditSource.UI,
    entity_type: "Student",
    entity_id: studentId,
    admin_id: admin.id,
    new_values: { resource: "HealthNote" },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

export class HealthNoteService {
  static async create(
    admin: AdminUser,
    request: CreateHealthNoteRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<HealthNoteResponse> {
    await assertWriteAllowed(admin, "create", context, now, request.student_id);
    await assertCanViewSensitiveData(admin, context);

    const createRequest = Validation.validate(
      HealthNoteValidation.CREATE,
      request,
    );

    await assertStudentExists(createRequest.student_id, true);

    const created = await prismaClient.$transaction(async (tx) => {
      const newNote = await tx.healthNote.create({
        data: {
          student_id: createRequest.student_id,
          category: createRequest.category,
          description: createRequest.description,
          status: createRequest.status,
          noted_date: createRequest.noted_date
            ? new Date(createRequest.noted_date)
            : undefined,
          resolved_date: createRequest.resolved_date
            ? new Date(createRequest.resolved_date)
            : undefined,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.CREATE_HEALTH_NOTE,
          source: AuditSource.UI,
          entity_type: "HealthNote",
          entity_id: newNote.id,
          admin_id: admin.id,
          new_values: toHealthNoteAuditSnapshot(newNote),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return newNote;
    });

    return toHealthNoteResponse(created);
  }

  static async update(
    admin: AdminUser,
    request: UpdateHealthNoteRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<HealthNoteResponse> {
    await assertWriteAllowed(admin, "update", context, now, request.student_id);
    await assertCanViewSensitiveData(admin, context);

    const updateRequest = Validation.validate(
      HealthNoteValidation.UPDATE,
      request,
    );

    await assertStudentExists(updateRequest.student_id, true);

    const existing = await prismaClient.healthNote.findFirst({
      where: { id: updateRequest.id, student_id: updateRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Health note not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(
        400,
        "Cannot update a deleted health note. Restore it first.",
      );
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      const updatedNote = await tx.healthNote.update({
        where: { id: existing.id },
        data: {
          category: updateRequest.category,
          description: updateRequest.description,
          status: updateRequest.status,
          noted_date: updateRequest.noted_date
            ? new Date(updateRequest.noted_date)
            : undefined,
          resolved_date: updateRequest.resolved_date
            ? new Date(updateRequest.resolved_date)
            : undefined,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.UPDATE_HEALTH_NOTE,
          source: AuditSource.UI,
          entity_type: "HealthNote",
          entity_id: updatedNote.id,
          admin_id: admin.id,
          old_values: toHealthNoteAuditSnapshot(existing),
          new_values: toHealthNoteAuditSnapshot(updatedNote),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return updatedNote;
    });

    return toHealthNoteResponse(updated);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteHealthNoteRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedHealthNoteAction(
        admin,
        "delete",
        context,
        request.student_id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete health data",
      );
    }

    const deleteRequest = Validation.validate(
      HealthNoteValidation.DELETE,
      request,
    );

    const existing = await prismaClient.healthNote.findFirst({
      where: { id: deleteRequest.id, student_id: deleteRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Health note not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "Health note is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.$transaction(async (tx) => {
      await tx.healthNote.update({
        where: { id: existing.id },
        data: { deleted_at: deletedAt },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_HEALTH_NOTE,
          source: AuditSource.UI,
          entity_type: "HealthNote",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toHealthNoteAuditSnapshot(existing),
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
    request: RestoreHealthNoteRequest,
    context: AuditRequestContext = {},
  ): Promise<HealthNoteResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedHealthNoteAction(
        admin,
        "restore",
        context,
        request.student_id,
      );
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore health data",
      );
    }

    const restoreRequest = Validation.validate(
      HealthNoteValidation.RESTORE,
      request,
    );

    const existing = await prismaClient.healthNote.findFirst({
      where: { id: restoreRequest.id, student_id: restoreRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Health note not found");
    }
    if (existing.deleted_at === null) {
      throw new ResponseError(
        400,
        "Health note is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    const restored = await prismaClient.$transaction(async (tx) => {
      const restoredNote = await tx.healthNote.update({
        where: { id: existing.id },
        data: { deleted_at: null },
      });

      await AuditService.record(
        {
          action: AuditAction.UPDATE_HEALTH_NOTE,
          source: AuditSource.UI,
          entity_type: "HealthNote",
          entity_id: restoredNote.id,
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

      return restoredNote;
    });

    return toHealthNoteResponse(restored);
  }

  static async getList(
    admin: AdminUser,
    request: GetHealthNoteListRequest,
    context: AuditRequestContext = {},
  ): Promise<HealthNoteResponse[]> {
    await assertCanViewSensitiveData(admin, context);

    const listRequest = Validation.validate(
      HealthNoteValidation.GET_LIST,
      request,
    );

    await assertStudentExists(listRequest.student_id);

    const notes = await prismaClient.healthNote.findMany({
      where: {
        student_id: listRequest.student_id,
        deleted_at: listRequest.is_deleted ? { not: null } : null,
      },
      orderBy: { noted_date: "desc" },
    });

    await recordHealthDataAccess(admin, listRequest.student_id, context);

    return notes.map(toHealthNoteResponse);
  }
}
