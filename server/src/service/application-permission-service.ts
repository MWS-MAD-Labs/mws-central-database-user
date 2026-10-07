import {
  AdminRole,
  ApplicationPermissionSource,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import type { ApiClientVariables } from "../type/hono-context";
import { ApplicationPermissionValidation } from "../validation/application-entitlement-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";

export type ApplicationPermissionResponse = {
  key: string;
  description: string | null;
  requires: string[];
  source: "MANIFEST" | "MANUAL";
  deprecated: boolean;
  role_count: number;
};

export type ApplicationPermissionList = {
  application_id: string;
  // False until the application has published its permissions at least once.
  has_manifest: boolean;
  last_synced_at: string | null;
  permissions: ApplicationPermissionResponse[];
};

function assertSuperAdmin(admin: AdminUser) {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    throw new ResponseError(403, "Forbidden: Only Super Admin can manage application permissions");
  }
}

// Roles can only carry permissions the application registered. Ones a role already carries stay
// allowed so an old role can still be saved after the application dropped one.
export async function assertPermissionsRegistered(
  applicationId: string,
  wanted: string[],
  alreadyCarried: string[] = [],
) {
  const fresh = [...new Set(wanted)].filter((key) => !alreadyCarried.includes(key));
  if (fresh.length === 0) return;
  const rows = await prismaClient.applicationPermission.findMany({
    where: { application_id: applicationId },
    select: { key: true, deprecated_at: true },
  });
  const usable = rows.filter((row) => !row.deprecated_at).map((row) => row.key);
  const unknown = fresh.filter((key) => !usable.includes(key));
  if (unknown.length === 0) return;
  const known = usable.length > 0 ? usable.sort().join(", ") : "none yet";
  throw new ResponseError(
    400,
    `Permission ${unknown.map((key) => `"${key}"`).join(", ")} is not registered for ${applicationId}. Known: ${known}`,
  );
}

type RequiresMap = Map<string, string[]>;

// Everything a permission needs, directly or through the ones it needs.
function requiredBy(key: string, requires: RequiresMap): string[] {
  const seen = new Set<string>();
  const queue = [...(requires.get(key) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(requires.get(next) ?? []));
  }
  return [...seen];
}

// Pairs of [permission, what it needs] that a set of permissions leaves out.
export function missingDependencies(permissions: string[], requires: RequiresMap): [string, string][] {
  const carried = new Set(permissions);
  return [...carried].flatMap((key) =>
    requiredBy(key, requires)
      .filter((needed) => !carried.has(needed))
      .map((needed): [string, string] => [key, needed]),
  );
}

export async function loadRequires(applicationId: string): Promise<RequiresMap> {
  const rows = await prismaClient.applicationPermission.findMany({
    where: { application_id: applicationId },
    select: { key: true, requires: true },
  });
  return new Map(rows.map((row) => [row.key, row.requires]));
}

// What each role of the given applications still lacks, by application.
export async function loadRequiresByApplication(applicationIds: string[]): Promise<Map<string, RequiresMap>> {
  const rows = await prismaClient.applicationPermission.findMany({
    where: { application_id: { in: applicationIds } },
    select: { application_id: true, key: true, requires: true },
  });
  const byApplication = new Map<string, RequiresMap>();
  for (const row of rows) {
    const map = byApplication.get(row.application_id) ?? new Map<string, string[]>();
    map.set(row.key, row.requires);
    byApplication.set(row.application_id, map);
  }
  return byApplication;
}

// A role has to carry what its permissions need.
export async function assertPermissionDependencies(applicationId: string, permissions: string[]) {
  const missing = missingDependencies(permissions, await loadRequires(applicationId));
  if (missing.length === 0) return;
  throw new ResponseError(
    400,
    missing.map(([key, needed]) => `Permission "${key}" needs "${needed}"`).join(". "),
  );
}

// What a manifest says it needs has to exist in the same manifest and cannot loop.
function assertManifestDependencies(permissions: { key: string; requires?: string[] }[]) {
  const map: RequiresMap = new Map(permissions.map((row) => [row.key, row.requires ?? []]));
  for (const [key, needs] of map) {
    for (const needed of needs) {
      if (needed === key) throw new ResponseError(400, `Permission "${key}" cannot need itself`);
      if (!map.has(needed)) throw new ResponseError(400, `Permission "${key}" needs "${needed}", which is not in the list`);
    }
  }
  for (const key of map.keys()) {
    if (requiredBy(key, map).includes(key)) {
      throw new ResponseError(400, `Permission "${key}" needs itself through the permissions it requires`);
    }
  }
}

export class ApplicationPermissionService {
  static async list(admin: AdminUser, request: { application_id?: string }): Promise<ApplicationPermissionList> {
    assertSuperAdmin(admin);
    const { application_id } = Validation.validate(ApplicationPermissionValidation.LIST, request as { application_id: string });
    const [rows, roles] = await Promise.all([
      prismaClient.applicationPermission.findMany({
        where: { application_id },
        orderBy: { key: "asc" },
      }),
      prismaClient.applicationRole.findMany({ where: { application_id }, select: { permissions: true } }),
    ]);
    const syncedAt = rows
      .map((row) => row.synced_at)
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    return {
      application_id,
      has_manifest: rows.some((row) => row.source === ApplicationPermissionSource.MANIFEST),
      last_synced_at: syncedAt ? syncedAt.toISOString() : null,
      permissions: rows.map((row) => ({
        key: row.key,
        description: row.description,
        requires: row.requires,
        source: row.source,
        deprecated: Boolean(row.deprecated_at),
        role_count: roles.filter((role) => role.permissions.includes(row.key)).length,
      })),
    };
  }

  // For an application that has not published a manifest yet.
  static async create(
    admin: AdminUser,
    request: { application_id: string; key: string; description?: string },
    context: AuditRequestContext = {},
  ): Promise<ApplicationPermissionResponse> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationPermissionValidation.CREATE, request);
    const manifest = await prismaClient.applicationPermission.count({
      where: { application_id: input.application_id, source: ApplicationPermissionSource.MANIFEST },
    });
    if (manifest > 0) {
      throw new ResponseError(
        400,
        `${input.application_id} publishes its own permissions. Add it to the application's code and deploy it.`,
      );
    }
    const existing = await prismaClient.applicationPermission.findUnique({
      where: { application_id_key: { application_id: input.application_id, key: input.key } },
    });
    if (existing) {
      throw new ResponseError(400, `Permission ${input.key} already exists for ${input.application_id}`);
    }
    const created = await prismaClient.$transaction(async (tx) => {
      const saved = await tx.applicationPermission.create({
        data: { application_id: input.application_id, key: input.key, description: input.description ?? null },
      });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_PERMISSION_CREATE,
          source: AuditSource.UI,
          entity_type: "ApplicationPermission",
          entity_id: saved.id,
          admin_id: admin.id,
          new_values: { application_id: saved.application_id, key: saved.key },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return saved;
    });
    return { key: created.key, description: created.description, requires: [], source: created.source, deprecated: false, role_count: 0 };
  }

  // An application publishes what its code understands. The client has to be the one made for it.
  static async sync(
    client: Pick<ApiClientVariables, "clientId">,
    request: { application_id: string; permissions: { key: string; description?: string; requires?: string[] }[] },
    context: AuditRequestContext = {},
  ) {
    const input = Validation.validate(ApplicationPermissionValidation.SYNC, request);
    assertManifestDependencies(input.permissions);
    const owner = await prismaClient.apiClient.findUnique({
      where: { id: client.clientId },
      select: { profile: { select: { code: true } } },
    });
    if (owner?.profile?.code !== input.application_id) {
      throw new ResponseError(403, `This API client may not publish permissions for ${input.application_id}`);
    }

    const now = new Date();
    const keys = input.permissions.map((row) => row.key);
    const result = await prismaClient.$transaction(async (tx) => {
      const existing = await tx.applicationPermission.findMany({ where: { application_id: input.application_id } });
      const byKey = new Map(existing.map((row) => [row.key, row]));
      let added = 0;
      for (const row of input.permissions) {
        const current = byKey.get(row.key);
        if (!current) {
          await tx.applicationPermission.create({
            data: {
              application_id: input.application_id,
              key: row.key,
              description: row.description ?? null,
              requires: row.requires ?? [],
              source: ApplicationPermissionSource.MANIFEST,
              synced_at: now,
            },
          });
          added += 1;
        } else {
          await tx.applicationPermission.update({
            where: { id: current.id },
            data: {
              description: row.description ?? current.description,
              requires: row.requires ?? [],
              source: ApplicationPermissionSource.MANIFEST,
              deprecated_at: null,
              synced_at: now,
            },
          });
        }
      }
      const dropped = existing.filter((row) => !keys.includes(row.key) && !row.deprecated_at);
      if (dropped.length > 0) {
        await tx.applicationPermission.updateMany({
          where: { id: { in: dropped.map((row) => row.id) } },
          data: { deprecated_at: now },
        });
      }
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_PERMISSION_SYNC,
          source: AuditSource.API,
          api_client_id: client.clientId,
          entity_type: "ApplicationPermission",
          entity_id: input.application_id,
          new_values: { application_id: input.application_id, total: keys.length, added, deprecated: dropped.map((row) => row.key) },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return { added, deprecated: dropped.map((row) => row.key) };
    });
    return { application_id: input.application_id, total: keys.length, ...result };
  }

  // What active roles carry, so the application can compare it with its code.
  static async usage(applicationId: string): Promise<string[]> {
    const roles = await prismaClient.applicationRole.findMany({
      where: { application_id: applicationId, is_active: true },
      select: { permissions: true },
    });
    return [...new Set(roles.flatMap((role) => role.permissions))].sort();
  }
}
