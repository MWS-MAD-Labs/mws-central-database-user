import { randomUUID } from "crypto";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
  type ApplicationLogo,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { MINIO_BUCKET, ensureBucketExists, minioClient } from "../lib/minio";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import type { ApplicationLogoResponse } from "../model/application-logo-model";
import { LogoImageError, processLogo } from "../utils/image-processing";
import { ApplicationLogoValidation } from "../validation/application-logo-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function assertSuperAdmin(admin: AdminUser) {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    throw new ResponseError(403, "Forbidden: Only Super Admin can manage application logos");
  }
}

function snapshot(row: ApplicationLogo) {
  return { name: row.name, width: row.width, height: row.height, bytes: row.bytes, version: row.version };
}

function toResponse(
  row: ApplicationLogo & { applications: { application_id: string; name: string }[] },
): ApplicationLogoResponse {
  return {
    id: row.id,
    name: row.name,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    version: row.version,
    used_by: row.applications.map((item) => ({ application_id: item.application_id, name: item.name })),
    created_at: row.created_at.toISOString(),
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function assertNameFree(name: string, exceptId?: string) {
  const taken = await prismaClient.applicationLogo.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (taken) throw new ResponseError(409, "A logo with this name already exists");
}

export class ApplicationLogoService {
  static async list(): Promise<ApplicationLogoResponse[]> {
    const rows = await prismaClient.applicationLogo.findMany({
      orderBy: { name: "asc" },
      include: { applications: { select: { application_id: true, name: true }, orderBy: { name: "asc" } } },
    });
    return rows.map(toResponse);
  }

  static async create(
    admin: AdminUser,
    nameInput: string,
    file: File,
    context: AuditRequestContext = {},
  ): Promise<ApplicationLogoResponse> {
    assertSuperAdmin(admin);
    const name = Validation.validate(ApplicationLogoValidation.NAME, nameInput);
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ResponseError(413, "The picture is too large, 2 MB at most");
    }
    await assertNameFree(name);
    let processed;
    try {
      processed = await processLogo(Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof LogoImageError) throw new ResponseError(400, error.message);
      throw error;
    }
    const objectKey = `application-logos/${randomUUID()}.webp`;
    await ensureBucketExists();
    await minioClient.putObject(MINIO_BUCKET, objectKey, processed.buffer, processed.buffer.length, {
      "Content-Type": "image/webp",
    });
    let created: ApplicationLogo;
    try {
      created = await prismaClient.applicationLogo.create({
        data: {
          name,
          object_key: objectKey,
          content_type: "image/webp",
          width: processed.width,
          height: processed.height,
          bytes: processed.buffer.length,
        },
      });
    } catch (error) {
      await minioClient.removeObject(MINIO_BUCKET, objectKey).catch(() => {});
      throw error;
    }
    await AuditService.record({
      action: AuditAction.CREATE_APPLICATION_LOGO,
      source: AuditSource.UI,
      entity_type: "ApplicationLogo",
      entity_id: created.id,
      admin_id: admin.id,
      new_values: snapshot(created),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return toResponse({ ...created, applications: [] });
  }

  static async rename(
    admin: AdminUser,
    id: string,
    nameInput: string,
    context: AuditRequestContext = {},
  ): Promise<ApplicationLogoResponse> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationLogoValidation.RENAME, { id, name: nameInput });
    const before = await prismaClient.applicationLogo.findUnique({ where: { id: input.id } });
    if (!before) throw new ResponseError(404, "Logo not found");
    if (before.name !== input.name) await assertNameFree(input.name, before.id);
    const after = await prismaClient.applicationLogo.update({
      where: { id: before.id },
      data: { name: input.name },
    });
    if (before.name !== after.name) {
      await AuditService.record({
        action: AuditAction.UPDATE_APPLICATION_LOGO,
        source: AuditSource.UI,
        entity_type: "ApplicationLogo",
        entity_id: after.id,
        admin_id: admin.id,
        old_values: snapshot(before),
        new_values: snapshot(after),
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      });
    }
    const withUse = await prismaClient.applicationLogo.findUniqueOrThrow({
      where: { id: after.id },
      include: { applications: { select: { application_id: true, name: true }, orderBy: { name: "asc" } } },
    });
    return toResponse(withUse);
  }

  static async remove(admin: AdminUser, id: string, context: AuditRequestContext = {}): Promise<{ id: string }> {
    assertSuperAdmin(admin);
    const row = await prismaClient.applicationLogo.findUnique({
      where: { id },
      include: { applications: { select: { name: true }, orderBy: { name: "asc" } } },
    });
    if (!row) throw new ResponseError(404, "Logo not found");
    if (row.applications.length > 0) {
      const names = row.applications.map((item) => item.name).join(", ");
      throw new ResponseError(409, `This logo is used by ${names}. Pick another logo for them first`);
    }
    await prismaClient.applicationLogo.delete({ where: { id } });
    await minioClient.removeObject(MINIO_BUCKET, row.object_key).catch(() => {});
    await AuditService.record({
      action: AuditAction.DELETE_APPLICATION_LOGO,
      source: AuditSource.UI,
      entity_type: "ApplicationLogo",
      entity_id: row.id,
      admin_id: admin.id,
      old_values: snapshot(row),
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return { id };
  }

  // The picture itself, for the admin screens and for the Hub.
  static async image(id: string): Promise<{ buffer: Buffer; contentType: string; version: number }> {
    const row = await prismaClient.applicationLogo.findUnique({ where: { id } });
    if (!row) throw new ResponseError(404, "Logo not found");
    const buffer = await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, row.object_key));
    return { buffer, contentType: row.content_type, version: row.version };
  }

  // A logo an application points at has to exist.
  static async assertExists(id: string): Promise<void> {
    const row = await prismaClient.applicationLogo.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new ResponseError(400, "That logo does not exist");
  }
}
