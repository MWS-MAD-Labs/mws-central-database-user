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
  toVaccineRecordAuditSnapshot,
  toVaccineRecordResponse,
  type CreateVaccineRecordRequest,
  type DeleteVaccineRecordRequest,
  type GetVaccineRecordListRequest,
  type RestoreVaccineRecordRequest,
  type UpdateVaccineRecordRequest,
  type VaccineRecordResponse,
} from "../model/vaccine-record-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertCanViewSensitiveData } from "../utils/sensitive-data";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { VaccineRecordValidation } from "../validation/vaccine-record-validation";
import { Validation } from "../validation/validation";

const DUPLICATE_VACCINE_RECORD_MESSAGE =
  "A vaccine record for this type already exists for this student.";

function rethrowAsFriendlyVaccineRecordConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("student_id") || fields?.includes("vaccine_type")) {
    throw new ResponseError(400, DUPLICATE_VACCINE_RECORD_MESSAGE);
  }
  throw error;
}

async function recordUnauthorizedVaccineRecordAction(
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
      reason: `blocked vaccine record ${action}`,
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
    await recordUnauthorizedVaccineRecordAction(admin, action, context, studentId);
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_data) {
      await recordUnauthorizedVaccineRecordAction(admin, action, context, studentId);
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
    new_values: { resource: "VaccineRecord" },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

export class VaccineRecordService {
  static async create(
    admin: AdminUser,
    request: CreateVaccineRecordRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<VaccineRecordResponse> {
    await assertWriteAllowed(admin, "create", context, now, request.student_id);
    await assertCanViewSensitiveData(admin, context);

    const createRequest = Validation.validate(
      VaccineRecordValidation.CREATE,
      request,
    );

    await assertStudentExists(createRequest.student_id, true);

    let created;
    try {
      created = await prismaClient.$transaction(async (tx) => {
        const newRecord = await tx.vaccineRecord.create({
          data: {
            student_id: createRequest.student_id,
            vaccine_type: createRequest.vaccine_type,
            received: createRequest.received,
            date: createRequest.date ? new Date(createRequest.date) : undefined,
          },
        });

        await AuditService.record(
          {
            action: AuditAction.CREATE_VACCINE_RECORD,
            source: AuditSource.UI,
            entity_type: "VaccineRecord",
            entity_id: newRecord.id,
            admin_id: admin.id,
            new_values: toVaccineRecordAuditSnapshot(newRecord),
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );

        return newRecord;
      });
    } catch (error) {
      rethrowAsFriendlyVaccineRecordConflict(error);
    }

    return toVaccineRecordResponse(created);
  }

  static async update(
    admin: AdminUser,
    request: UpdateVaccineRecordRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<VaccineRecordResponse> {
    await assertWriteAllowed(admin, "update", context, now, request.student_id);
    await assertCanViewSensitiveData(admin, context);

    const updateRequest = Validation.validate(
      VaccineRecordValidation.UPDATE,
      request,
    );

    await assertStudentExists(updateRequest.student_id, true);

    const existing = await prismaClient.vaccineRecord.findFirst({
      where: { id: updateRequest.id, student_id: updateRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Vaccine record not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(
        400,
        "Cannot update a deleted vaccine record. Restore it first.",
      );
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      const updatedRecord = await tx.vaccineRecord.update({
        where: { id: existing.id },
        data: {
          received: updateRequest.received,
          date: updateRequest.date ? new Date(updateRequest.date) : undefined,
        },
      });

      await AuditService.record(
        {
          action: AuditAction.UPDATE_VACCINE_RECORD,
          source: AuditSource.UI,
          entity_type: "VaccineRecord",
          entity_id: updatedRecord.id,
          admin_id: admin.id,
          old_values: toVaccineRecordAuditSnapshot(existing),
          new_values: toVaccineRecordAuditSnapshot(updatedRecord),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );

      return updatedRecord;
    });

    return toVaccineRecordResponse(updated);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteVaccineRecordRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedVaccineRecordAction(
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
      VaccineRecordValidation.DELETE,
      request,
    );

    const existing = await prismaClient.vaccineRecord.findFirst({
      where: { id: deleteRequest.id, student_id: deleteRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Vaccine record not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "Vaccine record is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.$transaction(async (tx) => {
      await tx.vaccineRecord.update({
        where: { id: existing.id },
        data: { deleted_at: deletedAt },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_VACCINE_RECORD,
          source: AuditSource.UI,
          entity_type: "VaccineRecord",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: toVaccineRecordAuditSnapshot(existing),
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
    request: RestoreVaccineRecordRequest,
    context: AuditRequestContext = {},
  ): Promise<VaccineRecordResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      await recordUnauthorizedVaccineRecordAction(
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
      VaccineRecordValidation.RESTORE,
      request,
    );

    const existing = await prismaClient.vaccineRecord.findFirst({
      where: { id: restoreRequest.id, student_id: restoreRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Vaccine record not found");
    }
    if (existing.deleted_at === null) {
      throw new ResponseError(
        400,
        "Vaccine record is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    const restored = await prismaClient.$transaction(async (tx) => {
      const restoredRecord = await tx.vaccineRecord.update({
        where: { id: existing.id },
        data: { deleted_at: null },
      });

      await AuditService.record(
        {
          action: AuditAction.UPDATE_VACCINE_RECORD,
          source: AuditSource.UI,
          entity_type: "VaccineRecord",
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

    return toVaccineRecordResponse(restored);
  }

  static async getList(
    admin: AdminUser,
    request: GetVaccineRecordListRequest,
    context: AuditRequestContext = {},
  ): Promise<VaccineRecordResponse[]> {
    await assertCanViewSensitiveData(admin, context);

    const listRequest = Validation.validate(
      VaccineRecordValidation.GET_LIST,
      request,
    );

    await assertStudentExists(listRequest.student_id);

    const records = await prismaClient.vaccineRecord.findMany({
      where: {
        student_id: listRequest.student_id,
        deleted_at: listRequest.is_deleted ? { not: null } : null,
      },
      orderBy: { created_at: "asc" },
    });

    await recordHealthDataAccess(admin, listRequest.student_id, context);

    return records.map(toVaccineRecordResponse);
  }
}
