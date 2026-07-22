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
  toConsentAuditSnapshot,
  toConsentResponse,
  type ConsentResponse,
  type CreateConsentRequest,
  type DeleteConsentRequest,
  type GetConsentListRequest,
  type RestoreConsentRequest,
  type UpdateConsentRequest,
} from "../model/consent-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { getUniqueConstraintFields } from "../utils/prisma-error";
import { ConsentValidation } from "../validation/consent-validation";
import { Validation } from "../validation/validation";

const DUPLICATE_CONSENT_MESSAGE =
  "A consent record for this type already exists for this student.";

function rethrowAsFriendlyConsentConflict(error: unknown): never {
  const fields = getUniqueConstraintFields(error);
  if (fields?.includes("student_id") || fields?.includes("consent_type")) {
    throw new ResponseError(400, DUPLICATE_CONSENT_MESSAGE);
  }
  throw error;
}

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

export class ConsentService {
  static async create(
    admin: AdminUser,
    request: CreateConsentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ConsentResponse> {
    await assertWriteAllowed(admin, context, now);

    const createRequest = Validation.validate(
      ConsentValidation.CREATE,
      request,
    );

    await assertStudentExists(createRequest.student_id, true);

    let created;
    try {
      created = await prismaClient.consentRecord.create({
        data: {
          student_id: createRequest.student_id,
          consent_type: createRequest.consent_type,
          status: createRequest.status,
          consent_date: createRequest.consent_date
            ? new Date(createRequest.consent_date)
            : undefined,
          signed_by: createRequest.signed_by,
          notes: createRequest.notes,
          validity_period: createRequest.validity_period
            ? new Date(createRequest.validity_period)
            : undefined,
        },
      });
    } catch (error) {
      rethrowAsFriendlyConsentConflict(error);
    }

    await AuditService.record({
      action: AuditAction.CREATE_CONSENT,
      source: AuditSource.UI,
      entity_type: "ConsentRecord",
      entity_id: created.id,
      admin_id: admin.id,
      new_values: toConsentAuditSnapshot(created),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toConsentResponse(created);
  }

  static async update(
    admin: AdminUser,
    request: UpdateConsentRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<ConsentResponse> {
    await assertWriteAllowed(admin, context, now);

    const updateRequest = Validation.validate(
      ConsentValidation.UPDATE,
      request,
    );

    await assertStudentExists(updateRequest.student_id, true);

    const existing = await prismaClient.consentRecord.findFirst({
      where: { id: updateRequest.id, student_id: updateRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Consent record not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(
        400,
        "Cannot update a deleted consent record. Restore it first.",
      );
    }

    const updated = await prismaClient.consentRecord.update({
      where: { id: existing.id },
      data: {
        status: updateRequest.status,
        consent_date: updateRequest.consent_date
          ? new Date(updateRequest.consent_date)
          : undefined,
        signed_by: updateRequest.signed_by,
        notes: updateRequest.notes,
        validity_period: updateRequest.validity_period
          ? new Date(updateRequest.validity_period)
          : undefined,
      },
    });

    await AuditService.record({
      action: AuditAction.UPDATE_CONSENT,
      source: AuditSource.UI,
      entity_type: "ConsentRecord",
      entity_id: updated.id,
      admin_id: admin.id,
      old_values: toConsentAuditSnapshot(existing),
      new_values: toConsentAuditSnapshot(updated),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toConsentResponse(updated);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteConsentRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can delete consent data",
      );
    }

    const deleteRequest = Validation.validate(
      ConsentValidation.DELETE,
      request,
    );

    const existing = await prismaClient.consentRecord.findFirst({
      where: { id: deleteRequest.id, student_id: deleteRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Consent record not found");
    }
    if (existing.deleted_at !== null) {
      throw new ResponseError(400, "Consent record is already deleted");
    }

    const deletedAt = new Date();
    await prismaClient.consentRecord.update({
      where: { id: existing.id },
      data: { deleted_at: deletedAt },
    });

    await AuditService.record({
      action: AuditAction.DELETE_CONSENT,
      source: AuditSource.UI,
      entity_type: "ConsentRecord",
      entity_id: existing.id,
      admin_id: admin.id,
      old_values: toConsentAuditSnapshot(existing),
      new_values: { deleted_at: deletedAt.toISOString() },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return true;
  }

  static async restore(
    admin: AdminUser,
    request: RestoreConsentRequest,
    context: AuditRequestContext = {},
  ): Promise<ConsentResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(
        403,
        "Forbidden: Only Super Admin can restore consent data",
      );
    }

    const restoreRequest = Validation.validate(
      ConsentValidation.RESTORE,
      request,
    );

    const existing = await prismaClient.consentRecord.findFirst({
      where: { id: restoreRequest.id, student_id: restoreRequest.student_id },
    });
    if (!existing) {
      throw new ResponseError(404, "Consent record not found");
    }
    if (existing.deleted_at === null) {
      throw new ResponseError(
        400,
        "Consent record is not in the trash bin. It might be active or permanently deleted.",
      );
    }

    const restored = await prismaClient.consentRecord.update({
      where: { id: existing.id },
      data: { deleted_at: null },
    });

    await AuditService.record({
      action: AuditAction.UPDATE_CONSENT,
      source: AuditSource.UI,
      entity_type: "ConsentRecord",
      entity_id: restored.id,
      admin_id: admin.id,
      old_values: { deleted_at: existing.deleted_at.toISOString() },
      new_values: { deleted_at: null },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return toConsentResponse(restored);
  }

  static async getList(
    admin: AdminUser,
    request: GetConsentListRequest,
  ): Promise<ConsentResponse[]> {
    void admin;

    const listRequest = Validation.validate(
      ConsentValidation.GET_LIST,
      request,
    );

    await assertStudentExists(listRequest.student_id);

    const consents = await prismaClient.consentRecord.findMany({
      where: {
        student_id: listRequest.student_id,
        deleted_at: listRequest.is_deleted ? { not: null } : null,
      },
      orderBy: { created_at: "asc" },
    });

    return consents.map(toConsentResponse);
  }
}
