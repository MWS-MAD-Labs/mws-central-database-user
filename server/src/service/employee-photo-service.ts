import { randomUUID } from "crypto";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import {
  MINIO_BUCKET,
  ensureBucketExists,
  minioClient,
  resolvePersonPhotoUrl,
} from "../lib/minio";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toBulkActionResponse,
  type BulkActionItemResponse,
} from "../model/bulk-action-model";
import {
  type BulkCommitEmployeePhotoRequest,
  type BulkCommitEmployeePhotoResponse,
  type BulkPreviewEmployeePhotoRequest,
  type BulkPreviewEmployeePhotoResponse,
  type DeleteEmployeePhotoRequest,
  type UploadEmployeePhotoRequest,
} from "../model/employee-photo-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import { assertEmployeeInAdminUnit } from "../utils/sensitive-data";
import { detectImageMimeType, processPhoto } from "../utils/image-processing";
import { EmployeePhotoValidation } from "../validation/employee-photo-validation";
import { Validation } from "../validation/validation";

const MAX_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024; // 15MB, before resize/convert

async function recordUnauthorizedPhotoAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  employeeId?: string,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: `blocked employee photo ${action}`,
      ...(employeeId ? { employee_id: employeeId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Employee PII (photos included) is gated by can_view_employee_pii, not the
// student-side can_view_sensitive_data flag - see employee-service.ts's
// assertCanWriteEmployeePii comment. Deliberately not unified.
async function assertWriteAllowed(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
  now: Date,
  employeeId?: string,
): Promise<void> {
  if (admin.role === AdminRole.VIEWER) {
    await recordUnauthorizedPhotoAction(admin, action, context, employeeId);
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_employee_data) {
      await recordUnauthorizedPhotoAction(admin, action, context, employeeId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to write employee data",
      );
    }
    await assertCanWriteNow(admin, context, now);
    if (employeeId) {
      await assertEmployeeInAdminUnit(admin, employeeId, context);
    }
  }
  if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_employee_pii) {
    await recordUnauthorizedPhotoAction(admin, action, context, employeeId);
    throw new ResponseError(
      403,
      "Forbidden: You don't have permission to set employee PII (NIK/NPWP/bank account/BPJS)",
    );
  }
}

async function assertEmployeeExists(
  employeeId: string,
): Promise<{ id: string; photo_object_key: string | null }> {
  const person = await prismaClient.person.findFirst({
    where: { employee: { id: employeeId, deleted_at: null } },
    select: { id: true, photo_object_key: true },
  });
  if (!person) {
    throw new ResponseError(404, "Employee not found");
  }
  return person;
}

async function removeObjectIfExists(objectKey: string | null): Promise<void> {
  if (!objectKey) return;
  await minioClient.removeObject(MINIO_BUCKET, objectKey).catch(() => {});
}

export async function resolveEmployeePhotoUrl(
  photoObjectKey: string | null,
  legacyPhotoUrl: string | null,
): Promise<string | null> {
  return resolvePersonPhotoUrl(photoObjectKey, legacyPhotoUrl);
}

// Filenames match against full_name, case-insensitively - "Adnan Aziz.png"
// against an employee named "Adnan Aziz". Extension is stripped by the
// caller (see stripExtension in the bulk-preview/commit methods) before
// this ever runs.
async function findCandidatesByName(candidateName: string) {
  const employees = await prismaClient.employee.findMany({
    where: {
      deleted_at: null,
      person: { full_name: { equals: candidateName, mode: "insensitive" } },
    },
    include: { person: true, unit: true },
  });

  return employees.map((employee) => ({
    id: employee.id,
    full_name: employee.person.full_name,
    employee_id: employee.employee_id,
    unit: employee.unit.name,
    has_photo: Boolean(
      employee.person.photo_object_key || employee.person.photo_url,
    ),
  }));
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[a-zA-Z0-9]+$/, "").trim();
}

export class EmployeePhotoService {
  static async upload(
    admin: AdminUser,
    request: UploadEmployeePhotoRequest,
    file: File,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    const uploadRequest = Validation.validate(
      EmployeePhotoValidation.UPLOAD,
      request,
    );

    await assertWriteAllowed(
      admin,
      "upload",
      context,
      now,
      uploadRequest.employee_id,
    );

    const person = await assertEmployeeExists(uploadRequest.employee_id);

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    if (rawBuffer.length > MAX_UPLOAD_SIZE_BYTES) {
      throw new ResponseError(
        400,
        `File is too large. Maximum size is ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB.`,
      );
    }
    if (!detectImageMimeType(rawBuffer)) {
      throw new ResponseError(
        400,
        "Unsupported or unrecognized file type. Allowed types: JPEG, PNG, WebP.",
      );
    }

    // detectImageMimeType only checks magic bytes - truncated/corrupt data
    // can still pass that and then fail to actually decode here.
    let processedBuffer: Buffer;
    try {
      processedBuffer = await processPhoto(rawBuffer);
    } catch {
      throw new ResponseError(400, "File could not be read as an image.");
    }
    const objectKey = `employee-photos/${uploadRequest.employee_id}/${randomUUID()}.avif`;

    await ensureBucketExists();
    await minioClient.putObject(
      MINIO_BUCKET,
      objectKey,
      processedBuffer,
      processedBuffer.length,
      { "Content-Type": "image/avif" },
    );

    const previousObjectKey = person.photo_object_key;
    try {
      await prismaClient.$transaction(async (tx) => {
        await tx.person.update({
          where: { id: person.id },
          data: { photo_object_key: objectKey },
        });

        await AuditService.record(
          {
            action: AuditAction.UPLOAD_EMPLOYEE_PHOTO,
            source: AuditSource.UI,
            entity_type: "Employee",
            entity_id: uploadRequest.employee_id,
            admin_id: admin.id,
            new_values: { photo_object_key: objectKey },
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
      });
    } catch (error) {
      await removeObjectIfExists(objectKey);
      throw error;
    }

    // Only after the new object is safely committed - avoids leaving the
    // employee photoless if something above failed.
    await removeObjectIfExists(previousObjectKey);

    return true;
  }

  static async remove(
    admin: AdminUser,
    request: DeleteEmployeePhotoRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    const deleteRequest = Validation.validate(
      EmployeePhotoValidation.DELETE,
      request,
    );

    await assertWriteAllowed(
      admin,
      "delete",
      context,
      now,
      deleteRequest.employee_id,
    );

    const person = await assertEmployeeExists(deleteRequest.employee_id);
    if (!person.photo_object_key) {
      throw new ResponseError(400, "This employee has no uploaded photo.");
    }

    const objectKey = person.photo_object_key;
    await prismaClient.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: person.id },
        data: { photo_object_key: null },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_EMPLOYEE_PHOTO,
          source: AuditSource.UI,
          entity_type: "Employee",
          entity_id: deleteRequest.employee_id,
          admin_id: admin.id,
          old_values: { photo_object_key: objectKey },
          new_values: { photo_object_key: null },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    await removeObjectIfExists(objectKey);

    return true;
  }

  // Matching only, no upload - lets the frontend show a review step (which
  // employee each file maps to, and flag ambiguous/unmatched ones) before
  // any file is actually sent.
  static async bulkPreview(
    admin: AdminUser,
    request: BulkPreviewEmployeePhotoRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkPreviewEmployeePhotoResponse> {
    if (admin.role !== AdminRole.SUPER_ADMIN && !admin.can_view_employee_pii) {
      await recordUnauthorizedPhotoAction(admin, "bulk preview", context);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to view employee PII (NIK/NPWP/bank account/BPJS)",
      );
    }

    const previewRequest = Validation.validate(
      EmployeePhotoValidation.BULK_PREVIEW,
      request,
    );

    const items = [];
    for (const fileName of previewRequest.file_names) {
      const candidates = await findCandidatesByName(stripExtension(fileName));
      items.push({ file_name: fileName, candidates });
    }

    return items;
  }

  static async bulkCommit(
    admin: AdminUser,
    request: BulkCommitEmployeePhotoRequest,
    files: Map<string, File>,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkCommitEmployeePhotoResponse> {
    // Generic gate up front (no employeeId - unit scope is per-mapping,
    // checked again inside each upload() call below), same shape as every
    // other bulk method in this codebase: one role check before the loop,
    // not just per-item.
    await assertWriteAllowed(admin, "bulk upload", context, now);

    const commitRequest = Validation.validate(
      EmployeePhotoValidation.BULK_COMMIT,
      request,
    );

    const items: BulkActionItemResponse<boolean>[] = [];

    for (const mapping of commitRequest.mappings) {
      try {
        const file = files.get(mapping.file_name);
        if (!file) {
          throw new ResponseError(
            400,
            `File "${mapping.file_name}" was not uploaded`,
          );
        }

        const data = await EmployeePhotoService.upload(
          admin,
          { employee_id: mapping.employee_id },
          file,
          context,
          now,
        );
        items.push({ id: mapping.file_name, status: "SUCCESS", data });
      } catch (error) {
        items.push({
          id: mapping.file_name,
          status: "FAILED",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return toBulkActionResponse(items);
  }
}
