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
  toParentGuardianAuditSnapshot,
  toParentGuardianResponse,
  type CreateParentGuardianRequest,
  type DeleteParentGuardianRequest,
  type GetParentGuardianListRequest,
  type ParentGuardianResponse,
  type RestoreParentGuardianRequest,
  type UpdateParentGuardianRequest,
} from "../model/parent-guardian-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { ParentGuardianValidation } from "../validation/parent-guardian-validation";
import { Validation } from "../validation/validation";

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

export class ParentGuardianService {
  static async create(
    admin: AdminUser,
    request: CreateParentGuardianRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ParentGuardianResponse> {
    await assertWriteAllowed(admin, context, now);

    const createRequest = Validation.validate(
      ParentGuardianValidation.CREATE,
      request,
    );

    await assertStudentExists(createRequest.student_id, true);

    const created = await prismaClient.$transaction(async (tx) => {
      if (createRequest.is_primary) {
        await tx.parentGuardian.updateMany({
          where: { student_id: createRequest.student_id, is_primary: true },
          data: { is_primary: false },
        });
      }

      return tx.parentGuardian.create({
        data: {
          student_id: createRequest.student_id,
          type: createRequest.type,
          full_name: createRequest.full_name,
          phone: createRequest.phone,
          email: createRequest.email,
          address: createRequest.address,
          is_primary: createRequest.is_primary ?? false,
        },
      });
    });

    await AuditService.record({
      action: AuditAction.CREATE_PARENT_GUARDIAN,
      source: AuditSource.UI,
      entity_type: "ParentGuardian",
      entity_id: created.id,
      admin_id: admin.id,
      new_values: toParentGuardianAuditSnapshot(created),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toParentGuardianResponse(created);
  }

  static async update(
    admin: AdminUser,
    request: UpdateParentGuardianRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ParentGuardianResponse> {
    await assertWriteAllowed(admin, context, now);

    const updateRequest = Validation.validate(
      ParentGuardianValidation.UPDATE,
      request,
    );

    await assertStudentExists(updateRequest.student_id, true);

    const existing = await prismaClient.parentGuardian.findFirst({
      where: { id: updateRequest.id, student_id: updateRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Parent/guardian contact not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(
        400,
        "Cannot update a deleted parent/guardian contact. Restore it first.",
      );
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      if (updateRequest.is_primary) {
        await tx.parentGuardian.updateMany({
          where: {
            student_id: updateRequest.student_id,
            is_primary: true,
            NOT: { id: existing.id },
          },
          data: { is_primary: false },
        });
      }

      return tx.parentGuardian.update({
        where: { id: existing.id },
        data: {
          type: updateRequest.type,
          full_name: updateRequest.full_name,
          phone: updateRequest.phone,
          email: updateRequest.email,
          address: updateRequest.address,
          is_primary: updateRequest.is_primary,
        },
      });
    });

    await AuditService.record({
      action: AuditAction.UPDATE_PARENT_GUARDIAN,
      source: AuditSource.UI,
      entity_type: "ParentGuardian",
      entity_id: updated.id,
      admin_id: admin.id,
      old_values: toParentGuardianAuditSnapshot(existing),
      new_values: toParentGuardianAuditSnapshot(updated),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toParentGuardianResponse(updated);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteParentGuardianRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete parent/guardian data",
      );
    }

    const deleteRequest = Validation.validate(
      ParentGuardianValidation.DELETE,
      request,
    );

    const existing = await prismaClient.parentGuardian.findFirst({
      where: { id: deleteRequest.id, student_id: deleteRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Parent/guardian contact not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(
        400,
        "Parent/guardian contact is already deleted",
      );
    }

    const deletedAt = new Date();
    await prismaClient.parentGuardian.update({
      where: { id: existing.id },
      data: { deleted_at: deletedAt },
    });

    await AuditService.record({
      action: AuditAction.DELETE_PARENT_GUARDIAN,
      source: AuditSource.UI,
      entity_type: "ParentGuardian",
      entity_id: existing.id,
      admin_id: admin.id,
      old_values: toParentGuardianAuditSnapshot(existing),
      new_values: { deleted_at: deletedAt.toISOString() },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return true;
  }

  static async restore(
    admin: AdminUser,
    request: RestoreParentGuardianRequest,
    context: AuditRequestContext = {},
  ): Promise<ParentGuardianResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore parent/guardian data",
      );
    }

    const restoreRequest = Validation.validate(
      ParentGuardianValidation.RESTORE,
      request,
    );

    const existing = await prismaClient.parentGuardian.findFirst({
      where: { id: restoreRequest.id, student_id: restoreRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Parent/guardian contact not found");
    }
    if (existing.deleted_at === null) {
      throw new ResponseError(
        400,
        "Parent/guardian contact is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    const restored = await prismaClient.parentGuardian.update({
      where: { id: existing.id },
      data: { deleted_at: null },
    });

    await AuditService.record({
      action: AuditAction.UPDATE_PARENT_GUARDIAN,
      source: AuditSource.UI,
      entity_type: "ParentGuardian",
      entity_id: restored.id,
      admin_id: admin.id,
      old_values: { deleted_at: existing.deleted_at.toISOString() },
      new_values: { deleted_at: null },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toParentGuardianResponse(restored);
  }

  static async getList(
    admin: AdminUser,
    request: GetParentGuardianListRequest,
  ): Promise<ParentGuardianResponse[]> {
    void admin;

    const listRequest = Validation.validate(
      ParentGuardianValidation.GET_LIST,
      request,
    );

    await assertStudentExists(listRequest.student_id);

    const parents = await prismaClient.parentGuardian.findMany({
      where: {
        student_id: listRequest.student_id,
        deleted_at: listRequest.is_deleted ? { not: null } : null,
      },
      orderBy: { created_at: "asc" },
    });

    return parents.map(toParentGuardianResponse);
  }
}
