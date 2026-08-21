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
  minioPresignClient,
} from "../lib/minio";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toBulkActionResponse,
  type BulkActionItemResponse,
} from "../model/bulk-action-model";
import {
  type BulkCommitStudentPhotoRequest,
  type BulkCommitStudentPhotoResponse,
  type BulkPreviewStudentPhotoRequest,
  type BulkPreviewStudentPhotoResponse,
  type DeleteStudentPhotoRequest,
  type UploadStudentPhotoRequest,
} from "../model/student-photo-model";
import { AuditService } from "./audit-service";
import { assertCanWriteNow } from "../utils/office-hours";
import {
  assertCanViewSensitiveData,
  assertStudentInAdminUnit,
} from "../utils/sensitive-data";
import { detectImageMimeType, processPhoto } from "../utils/image-processing";
import { StudentPhotoValidation } from "../validation/student-photo-validation";
import { Validation } from "../validation/validation";

const MAX_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024; // 15MB, before resize/convert
const PHOTO_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour

async function recordUnauthorizedPhotoAction(
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
      reason: `blocked student photo ${action}`,
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
    await recordUnauthorizedPhotoAction(admin, action, context, studentId);
    throw new ResponseError(403, "Forbidden: Viewer cannot modify data");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) {
    if (!admin.can_write_data) {
      await recordUnauthorizedPhotoAction(admin, action, context, studentId);
      throw new ResponseError(
        403,
        "Forbidden: You don't have permission to modify data",
      );
    }
    if (!admin.can_write_student_data) {
      await recordUnauthorizedPhotoAction(admin, action, context, studentId);
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
  await assertCanViewSensitiveData(admin, context);
}

async function assertStudentExists(
  studentId: string,
): Promise<{ id: string; photo_object_key: string | null }> {
  const person = await prismaClient.person.findFirst({
    where: { student: { id: studentId, deleted_at: null } },
    select: { id: true, photo_object_key: true },
  });
  if (!person) {
    throw new ResponseError(404, "Student not found");
  }
  return person;
}

async function removeObjectIfExists(objectKey: string | null): Promise<void> {
  if (!objectKey) return;
  await minioClient.removeObject(MINIO_BUCKET, objectKey).catch(() => {});
}

// Never stored - a stored presigned URL would go stale. Generated fresh
// every time a student's detail response is built.
export async function resolveStudentPhotoUrl(
  photoObjectKey: string | null,
  legacyPhotoUrl: string | null,
): Promise<string | null> {
  if (!photoObjectKey) return legacyPhotoUrl;
  return minioPresignClient.presignedGetObject(
    MINIO_BUCKET,
    photoObjectKey,
    PHOTO_URL_EXPIRY_SECONDS,
  );
}

// Filenames match against full_name, case-insensitively - "Adnan Aziz.png"
// against a student named "Adnan Aziz". Extension is stripped by the
// caller (see stripExtension in the bulk-preview/commit methods) before
// this ever runs.
async function findCandidatesByName(candidateName: string) {
  const students = await prismaClient.student.findMany({
    where: {
      deleted_at: null,
      person: { full_name: { equals: candidateName, mode: "insensitive" } },
    },
    include: { person: true, current_grade: true },
  });

  return students.map((student) => ({
    id: student.id,
    full_name: student.person.full_name,
    nis: student.nis,
    current_grade: student.current_grade.name,
    has_photo: Boolean(
      student.person.photo_object_key || student.person.photo_url,
    ),
  }));
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[a-zA-Z0-9]+$/, "").trim();
}

export class StudentPhotoService {
  static async upload(
    admin: AdminUser,
    request: UploadStudentPhotoRequest,
    file: File,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    const uploadRequest = Validation.validate(
      StudentPhotoValidation.UPLOAD,
      request,
    );

    await assertWriteAllowed(
      admin,
      "upload",
      context,
      now,
      uploadRequest.student_id,
    );

    const person = await assertStudentExists(uploadRequest.student_id);

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
    const objectKey = `student-photos/${uploadRequest.student_id}/${randomUUID()}.avif`;

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
            action: AuditAction.UPLOAD_STUDENT_PHOTO,
            source: AuditSource.UI,
            entity_type: "Student",
            entity_id: uploadRequest.student_id,
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
    // student photoless if something above failed.
    await removeObjectIfExists(previousObjectKey);

    return true;
  }

  static async remove(
    admin: AdminUser,
    request: DeleteStudentPhotoRequest,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<boolean> {
    const deleteRequest = Validation.validate(
      StudentPhotoValidation.DELETE,
      request,
    );

    await assertWriteAllowed(
      admin,
      "delete",
      context,
      now,
      deleteRequest.student_id,
    );

    const person = await assertStudentExists(deleteRequest.student_id);
    if (!person.photo_object_key) {
      throw new ResponseError(400, "This student has no uploaded photo.");
    }

    const objectKey = person.photo_object_key;
    await prismaClient.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: person.id },
        data: { photo_object_key: null },
      });

      await AuditService.record(
        {
          action: AuditAction.DELETE_STUDENT_PHOTO,
          source: AuditSource.UI,
          entity_type: "Student",
          entity_id: deleteRequest.student_id,
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
  // student each file maps to, and flag ambiguous/unmatched ones) before
  // any file is actually sent.
  static async bulkPreview(
    admin: AdminUser,
    request: BulkPreviewStudentPhotoRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkPreviewStudentPhotoResponse> {
    await assertCanViewSensitiveData(admin, context);

    const previewRequest = Validation.validate(
      StudentPhotoValidation.BULK_PREVIEW,
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
    request: BulkCommitStudentPhotoRequest,
    files: Map<string, File>,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<BulkCommitStudentPhotoResponse> {
    // Generic gate up front (no studentId - unit scope is per-mapping,
    // checked again inside each upload() call below), same shape as every
    // other bulk method in this codebase: one role check before the loop,
    // not just per-item.
    await assertWriteAllowed(admin, "bulk upload", context, now);

    const commitRequest = Validation.validate(
      StudentPhotoValidation.BULK_COMMIT,
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

        const data = await StudentPhotoService.upload(
          admin,
          { student_id: mapping.student_id },
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
