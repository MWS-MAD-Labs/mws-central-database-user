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
  toHealthRecordAuditSnapshot,
  toHealthRecordResponse,
  type CreateHealthRecordRequest,
  type DeleteHealthRecordRequest,
  type GetHealthRecordRequest,
  type HealthRecordResponse,
  type RestoreHealthRecordRequest,
  type UpdateHealthRecordRequest,
} from "../model/health-record-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertCanViewSensitiveData } from "../utils/sensitive-data";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { HealthRecordValidation } from "../validation/health-record-validation";
import { Validation } from "../validation/validation";

const DUPLICATE_HEALTH_RECORD_MESSAGE =
  "A health record already exists for this student. If it was deleted, restore it instead.";

function rethrowAsFriendlyHealthRecordConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("student_id")) {
    throw new ResponseError(400, DUPLICATE_HEALTH_RECORD_MESSAGE);
  }
  throw error;
}

async function recordUnauthorizedHealthRecordAction(
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
      reason: `blocked health record ${action}`,
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
    await recordUnauthorizedHealthRecordAction(admin, action, context, studentId);
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_data) {
      await recordUnauthorizedHealthRecordAction(admin, action, context, studentId);
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
    new_values: { resource: "HealthRecord" },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

export class HealthRecordService {
  static async create(
    admin: AdminUser,
    request: CreateHealthRecordRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<HealthRecordResponse> {
    await assertWriteAllowed(admin, "create", context, now, request.student_id);
    await assertCanViewSensitiveData(admin, context);

    const createRequest = Validation.validate(
      HealthRecordValidation.CREATE,
      request,
    );

    await assertStudentExists(createRequest.student_id, true);

    let created;
    try {
      created = await prismaClient.$transaction(async (tx) => {
        const newRecord = await tx.healthRecord.create({
          data: {
            student_id: createRequest.student_id,
            blood_type: createRequest.blood_type,
            needs_assistance: createRequest.needs_assistance,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_HEALTH_RECORD,
            source: AuditSource.UI,
            entity_type: "HealthRecord",
            entity_id: newRecord.id,
            admin_id: admin.id,
            new_values: toHealthRecordAuditSnapshot(newRecord),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newRecord;
      });
    } catch (error) {
      rethrowAsFriendlyHealthRecordConflict(error);
    }

    return toHealthRecordResponse(created);
  }

  static async update(
    admin: AdminUser,
    request: UpdateHealthRecordRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<HealthRecordResponse> {
    await assertWriteAllowed(admin, "update", context, now, request.student_id);
    await assertCanViewSensitiveData(admin, context);

    const updateRequest = Validation.validate(
      HealthRecordValidation.UPDATE,
      request,
    );

    await assertStudentExists(updateRequest.student_id, true);

    const existing = await prismaClient.healthRecord.findFirst({
      where: { student_id: updateRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Health record not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(
        400,
        "Cannot update a deleted health record. Restore it first.",
      );
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      const updatedRecord = await tx.healthRecord.update({
        where: { id: existing.id },
        data: {
          blood_type: updateRequest.blood_type,
          needs_assistance: updateRequest.needs_assistance,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.UPDATE_HEALTH_RECORD,
          source: AuditSource.UI,
          entity_type: "HealthRecord",
          entity_id: updatedRecord.id,
          admin_id: admin.id,
          old_values: toHealthRecordAuditSnapshot(existing),
          new_values: toHealthRecordAuditSnapshot(updatedRecord),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return updatedRecord;
    });

    return toHealthRecordResponse(updated);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteHealthRecordRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedHealthRecordAction(
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
      HealthRecordValidation.DELETE,
      request,
    );

    const existing = await prismaClient.healthRecord.findFirst({
      where: { student_id: deleteRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Health record not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "Health record is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.$transaction(async (tx) => {
      await tx.healthRecord.update({
        where: { id: existing.id },
        data: { deleted_at: deletedAt },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_HEALTH_RECORD,
          source: AuditSource.UI,
          entity_type: "HealthRecord",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toHealthRecordAuditSnapshot(existing),
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
    request: RestoreHealthRecordRequest,
    context: AuditRequestContext = {},
  ): Promise<HealthRecordResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedHealthRecordAction(
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
      HealthRecordValidation.RESTORE,
      request,
    );

    const existing = await prismaClient.healthRecord.findFirst({
      where: { student_id: restoreRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Health record not found");
    }
    if (existing.deleted_at === null) {
      throw new ResponseError(
        400,
        "Health record is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    const restored = await prismaClient.$transaction(async (tx) => {
      const restoredRecord = await tx.healthRecord.update({
        where: { id: existing.id },
        data: { deleted_at: null },
      });

      await AuditService.record(
        {
          action: AuditAction.UPDATE_HEALTH_RECORD,
          source: AuditSource.UI,
          entity_type: "HealthRecord",
          entity_id: restoredRecord.id,
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

      return restoredRecord;
    });

    return toHealthRecordResponse(restored);
  }

  static async get(
    admin: AdminUser,
    request: GetHealthRecordRequest,
    context: AuditRequestContext = {},
  ): Promise<HealthRecordResponse> {
    await assertCanViewSensitiveData(admin, context);

    const getRequest = Validation.validate(HealthRecordValidation.GET, request);

    await assertStudentExists(getRequest.student_id);

    const record = await prismaClient.healthRecord.findFirst({
      where: { student_id: getRequest.student_id, deleted_at: null },
    });
    if (!record) {
      throw new ResponseError(404, "Health record not found");
    }

    await recordHealthDataAccess(admin, getRequest.student_id, context);

    return toHealthRecordResponse(record);
  }
}
