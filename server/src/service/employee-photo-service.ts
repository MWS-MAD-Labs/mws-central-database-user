import { createHash, randomUUID } from "crypto";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  GoogleSyncStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { getDirectoryClient } from "../lib/google-workspace";
import { logger } from "../lib/logger";
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
import { detectImageMimeType, processPhoto, processPhotoForGoogle } from "../utils/image-processing";
import { GoogleWorkspaceService, assertAllowedTarget } from "./google-workspace-service";
import { EmployeePhotoValidation } from "../validation/employee-photo-validation";
import { Validation } from "../validation/validation";
import { resolveWriteUnitScope } from "../utils/admin-permissions";

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
    entity_type: "Employee",
    entity_id: employeeId,
    new_values: {
      reason: `blocked employee photo ${action}`,
      ...(employeeId ? { employee_id: employeeId } : {}),
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}

// Employee photos use employee PII permission, not student sensitive-data permission.
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

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

// After a photo went to Google, note what Google now holds, so the next sync does not take Google's own copy of it back.
async function rememberGooglePhoto(personId: string): Promise<void> {
  try {
    const photo = await GoogleWorkspaceService.getPhoto(personId);
    if (photo) await prismaClient.person.update({ where: { id: personId }, data: { google_photo_hash: sha256(photo.data) } });
  } catch (error) {
    logger.error(`Noting the Google photo failed for person ${personId}`, error);
  }
}

export async function resolveEmployeePhotoUrl(
  photoObjectKey: string | null,
  legacyPhotoUrl: string | null,
): Promise<string | null> {
  return resolvePersonPhotoUrl(photoObjectKey, legacyPhotoUrl);
}

// Match extensionless filenames to employee names case-insensitively.
async function findCandidatesByName(
  candidateName: string,
  employeeUnitScope: string[] | undefined,
) {
  const employees = await prismaClient.employee.findMany({
    where: {
      deleted_at: null,
      ...(employeeUnitScope === undefined
        ? {}
        : { unit_id: { in: employeeUnitScope } }),
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
          data: { photo_object_key: objectKey, photo_updated_at: new Date() },
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

    // Google wins on the next sync, so it gets this photo too. Best effort: the photo in Central stays if it fails.
    try {
      const sent = await GoogleWorkspaceService.setPhoto(person.id, await processPhotoForGoogle(rawBuffer), "image/jpeg");
      if (sent) await rememberGooglePhoto(person.id);
    } catch (error) {
      logger.error(`Sending the photo to Google failed for person ${person.id}`, error);
    }

    return true;
  }

  // The signed-in employee changes their own photo, in Central and in their Google account. Nobody else does it through
  // this route: the person comes from the session, never from the request.
  static async uploadOwn(
    personId: string,
    employeeId: string,
    file: File,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
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

    let processedBuffer: Buffer;
    let googleBuffer: Buffer;
    try {
      processedBuffer = await processPhoto(rawBuffer);
      googleBuffer = await processPhotoForGoogle(rawBuffer);
    } catch {
      throw new ResponseError(400, "File could not be read as an image.");
    }
    await this.saveOwnPhoto(personId, employeeId, processedBuffer, context, {});

    // Google follows when the account is linked. If it fails, the photo in Central stays and the next change retries.
    if (await GoogleWorkspaceService.setPhoto(personId, googleBuffer, "image/jpeg")) await rememberGooglePhoto(personId);
    return true;
  }

  // Stores a processed photo as the person's own and records it. Shared by an upload and by taking the Google photo.
  private static async saveOwnPhoto(
    personId: string,
    employeeId: string,
    processedBuffer: Buffer,
    context: AuditRequestContext,
    extra: Record<string, unknown>,
    googlePhotoHash?: string,
  ): Promise<void> {
    const objectKey = `employee-photos/${employeeId}/${randomUUID()}.avif`;

    await ensureBucketExists();
    await minioClient.putObject(MINIO_BUCKET, objectKey, processedBuffer, processedBuffer.length, {
      "Content-Type": "image/avif",
    });

    const previous = await prismaClient.person.findUnique({
      where: { id: personId },
      select: { photo_object_key: true },
    });
    try {
      await prismaClient.$transaction(async (tx) => {
        await tx.person.update({
          where: { id: personId },
          data: { photo_object_key: objectKey, photo_updated_at: new Date(), ...(googlePhotoHash ? { google_photo_hash: googlePhotoHash } : {}) },
        });
        await AuditService.record(
          {
            action: AuditAction.UPLOAD_OWN_PHOTO,
            source: AuditSource.UI,
            entity_type: "Employee",
            entity_id: employeeId,
            new_values: { photo_object_key: objectKey, ...extra },
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
    await removeObjectIfExists(previous?.photo_object_key ?? null);
  }

  // Takes the photo of the linked Google account. Google wins for an employee: a photo that differs from the last one seen
  // replaces the one in Central. The first time, a photo Central already has is kept and only noted as the starting
  // point, so a photo that was never sent to Google is not lost; Google changes after that win. `force` (the Use Google
  // photo button) takes it whatever Central holds. Returns whether the photo in Central changed.
  static async syncFromGoogle(
    personId: string,
    context: AuditRequestContext = {},
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    const person = await prismaClient.person.findFirst({
      where: { id: personId, deleted_at: null, employee: { deleted_at: null } },
      select: { email: true, photo_object_key: true, photo_url: true, google_photo_hash: true, employee: { select: { id: true } } },
    });
    if (!person?.employee) return false;
    try {
      assertAllowedTarget(person.email);
    } catch {
      return false;
    }
    const photo = await GoogleWorkspaceService.getPhoto(personId);
    if (!photo || !detectImageMimeType(photo.data)) return false;
    const hash = sha256(photo.data);
    if (!options.force) {
      if (hash === person.google_photo_hash) return false;
      if (!person.google_photo_hash && (person.photo_object_key || person.photo_url)) {
        await prismaClient.person.update({ where: { id: personId }, data: { google_photo_hash: hash } });
        return false;
      }
    }
    let processed: Buffer;
    try {
      processed = await processPhoto(photo.data);
    } catch {
      return false;
    }
    await this.saveOwnPhoto(personId, person.employee.id, processed, context, { source: "google" }, hash);
    return true;
  }

  // The hourly sweep: every linked employee, one after another, so Google is not asked all at once. Does nothing while
  // Google is simulated. A failure for one person never stops the rest.
  static async syncAllFromGoogle(): Promise<number> {
    if (getDirectoryClient().mode === "simulated") return 0;
    const linked = await prismaClient.person.findMany({
      where: {
        deleted_at: null,
        google_user_id: { not: null },
        google_sync_status: GoogleSyncStatus.ACTIVE,
        employee: { deleted_at: null, status: EmployeeStatus.ACTIVE },
      },
      select: { id: true },
    });
    let changed = 0;
    for (const { id } of linked) {
      try {
        if (await this.syncFromGoogle(id)) changed += 1;
      } catch (error) {
        logger.error(`Google photo sync failed for person ${id}`, error);
      }
    }
    return changed;
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
        data: { photo_object_key: null, photo_updated_at: new Date() },
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

  // Match filenames before uploading file contents.
  static async bulkPreview(
    admin: AdminUser,
    request: BulkPreviewEmployeePhotoRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkPreviewEmployeePhotoResponse> {
    await assertWriteAllowed(admin, "bulk preview", context, now);

    const previewRequest = Validation.validate(
      EmployeePhotoValidation.BULK_PREVIEW,
      request,
    );

    const items = [];
    const employeeUnitScope = resolveWriteUnitScope(admin, "employee");
    for (const fileName of previewRequest.file_names) {
      const candidates = await findCandidatesByName(
        stripExtension(fileName),
        employeeUnitScope,
      );
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
    // Check the bulk role once; each upload still enforces employee unit scope.
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
