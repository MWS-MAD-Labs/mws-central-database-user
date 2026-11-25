import { AdminRole, AuditAction, AuditSource, EmployeeStatus, type AdminUser } from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { AuditService } from "./audit-service";
import { ApplicationEntitlementService, clearActiveSnapshot } from "./application-entitlement-service";

type UnitAssignmentMetadata = {
  scope: "unit";
  label: string;
  mode: "explicit" | "derived_home_unit";
  exclusive_group?: string;
  include_descendants?: boolean;
};

function unitAssignmentMetadata(value: unknown): UnitAssignmentMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.scope !== "unit" ||
    typeof row.label !== "string" ||
    (row.mode !== "explicit" && row.mode !== "derived_home_unit")
  ) return null;
  return {
    scope: "unit",
    label: row.label,
    mode: row.mode,
    ...(typeof row.exclusive_group === "string" ? { exclusive_group: row.exclusive_group } : {}),
    ...(typeof row.include_descendants === "boolean" ? { include_descendants: row.include_descendants } : {}),
  };
}

export type ApplicationUnitAssignmentInput = {
  unit_id: string;
  permission_key: string;
  person_ids: string[];
};

function assertSuperAdmin(admin: AdminUser) {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    throw new ResponseError(403, "Forbidden: Only Super Admin can manage unit assignments");
  }
}

export class ApplicationUnitAssignmentService {
  static async list(admin: AdminUser, applicationId: string) {
    assertSuperAdmin(admin);
    const [units, assignments, assignmentSets, permissionRows, activePersonIds] = await Promise.all([
      prismaClient.masterUnit.findMany({
        where: { name: { not: "Unknown / Legacy" } },
        select: { id: true, name: true, parent_id: true },
        orderBy: { name: "asc" },
      }),
      prismaClient.applicationUnitAssignment.findMany({
        where: { application_id: applicationId },
        select: {
          id: true,
          unit_id: true,
          permission_key: true,
          person: { select: { id: true, full_name: true, email: true } },
        },
        orderBy: [{ person: { full_name: "asc" } }, { person_id: "asc" }],
      }),
      prismaClient.applicationUnitAssignmentSet.findMany({
        where: { application_id: applicationId },
        select: { unit_id: true, permission_key: true },
      }),
      prismaClient.applicationPermission.findMany({
        where: { application_id: applicationId, deprecated_at: null },
        select: { key: true, unit_assignment: true },
        orderBy: { key: "asc" },
      }),
      ApplicationEntitlementService.activePersonIds(applicationId),
    ]);
    const responsibilities = permissionRows.flatMap((permission) => {
      const metadata = unitAssignmentMetadata(permission.unit_assignment);
      return metadata ? [{ key: permission.key, ...metadata }] : [];
    });
    const activePermissionKeys = new Set(responsibilities.map((row) => row.key));
    return {
      responsibilities,
      units: units.map((unit) => ({
        ...unit,
        managed_permission_keys: assignmentSets
          .filter((set) => set.unit_id === unit.id)
          .map((set) => set.permission_key),
        assignments: assignments
          .filter((assignment) => assignment.unit_id === unit.id)
          .map((assignment) => ({
            id: assignment.id,
            permission_key: assignment.permission_key,
            person: assignment.person,
            active: activePersonIds.has(assignment.person.id) && activePermissionKeys.has(assignment.permission_key),
            inactive_reason: !activePermissionKeys.has(assignment.permission_key)
              ? "permission_unavailable"
              : activePersonIds.has(assignment.person.id)
                ? null
                : "application_access_inactive",
          })),
      })),
    };
  }

  static async replace(
    admin: AdminUser,
    applicationId: string,
    input: ApplicationUnitAssignmentInput,
    context: AuditRequestContext = {},
  ) {
    assertSuperAdmin(admin);
    const unitId = input.unit_id?.trim();
    const permissionKey = input.permission_key?.trim();
    const personIds = [...new Set((input.person_ids ?? []).map((id) => id.trim()).filter(Boolean))];
    if (!unitId || !permissionKey || !Array.isArray(input.person_ids)) {
      throw new ResponseError(400, "unit_id, permission_key and person_ids are required");
    }

    const [unit, permission, people, activePersonIds, application] = await Promise.all([
      prismaClient.masterUnit.findUnique({ where: { id: unitId }, select: { id: true } }),
      prismaClient.applicationPermission.findUnique({
        where: { application_id_key: { application_id: applicationId, key: permissionKey } },
        select: { key: true, deprecated_at: true, unit_assignment: true },
      }),
      prismaClient.person.findMany({
        where: {
          id: { in: personIds },
          deleted_at: null,
          employee: { status: EmployeeStatus.ACTIVE, deleted_at: null },
        },
        select: { id: true },
      }),
      ApplicationEntitlementService.activePersonIds(applicationId),
      prismaClient.application.findUnique({
        where: { application_id: applicationId },
        select: { retired_at: true },
      }),
    ]);
    if (!unit) throw new ResponseError(400, "Unit does not exist");
    if (!permission || permission.deprecated_at) throw new ResponseError(400, "Permission is not active for this application");
    if (application?.retired_at) throw new ResponseError(400, "Retired applications cannot change Unit assignments");
    const metadata = unitAssignmentMetadata(permission.unit_assignment);
    if (!metadata || metadata.mode !== "explicit") {
      throw new ResponseError(400, "Permission is not an explicit Unit assignment");
    }
    if (people.length !== personIds.length) throw new ResponseError(400, "Every assignee must be an active employee");
    if (personIds.some((personId) => !activePersonIds.has(personId))) {
      throw new ResponseError(400, "Every assignee must have active access to this application");
    }

    const exclusiveKeys = metadata.exclusive_group
      ? (await prismaClient.applicationPermission.findMany({
          where: { application_id: applicationId, deprecated_at: null },
          select: { key: true, unit_assignment: true },
        }))
          .filter((row) => row.key !== permissionKey)
          .filter((row) => unitAssignmentMetadata(row.unit_assignment)?.exclusive_group === metadata.exclusive_group)
          .map((row) => row.key)
      : [];

    const result = await prismaClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`application-unit-assignment:${applicationId}:${unitId}:${metadata.exclusive_group ?? permissionKey}`}))`;
      const previous = await tx.applicationUnitAssignment.findMany({
        where: { application_id: applicationId, unit_id: unitId, permission_key: permissionKey },
        select: { person_id: true },
      });
      const exclusiveRemovals = exclusiveKeys.length && personIds.length
        ? await tx.applicationUnitAssignment.findMany({
            where: {
              application_id: applicationId,
              unit_id: unitId,
              person_id: { in: personIds },
              permission_key: { in: exclusiveKeys },
            },
            select: { person_id: true, permission_key: true },
          })
        : [];
      await tx.applicationUnitAssignmentSet.upsert({
        where: {
          application_id_unit_id_permission_key: {
            application_id: applicationId,
            unit_id: unitId,
            permission_key: permissionKey,
          },
        },
        create: {
          application_id: applicationId,
          unit_id: unitId,
          permission_key: permissionKey,
        },
        update: {},
      });
      await tx.applicationUnitAssignment.deleteMany({
        where: { application_id: applicationId, unit_id: unitId, permission_key: permissionKey },
      });
      if (personIds.length) {
        if (exclusiveKeys.length) {
          await tx.applicationUnitAssignment.deleteMany({
            where: {
              application_id: applicationId,
              unit_id: unitId,
              person_id: { in: personIds },
              permission_key: { in: exclusiveKeys },
            },
          });
        }
        await tx.applicationUnitAssignment.createMany({
          data: personIds.map((personId) => ({
            application_id: applicationId,
            unit_id: unitId,
            person_id: personId,
            permission_key: permissionKey,
          })),
        });
      }
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_UPDATE,
          source: AuditSource.UI,
          entity_type: "ApplicationUnitAssignment",
          // Audit entity IDs are limited to 50 characters.
          entity_id: unitId,
          admin_id: admin.id,
          old_values: {
            application_id: applicationId,
            unit_id: unitId,
            permission_key: permissionKey,
            person_ids: previous.map((row) => row.person_id).sort(),
            exclusive_assignments_removed: exclusiveRemovals,
          },
          new_values: {
            application_id: applicationId,
            unit_id: unitId,
            permission_key: permissionKey,
            person_ids: [...personIds].sort(),
          },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return { unit_id: unitId, permission_key: permissionKey, person_ids: personIds };
    });
    clearActiveSnapshot(applicationId);
    return result;
  }

  static async listActive(applicationId: string) {
    const [assignments, managedSets, permissionRows, activePersonIds, application] = await Promise.all([
      prismaClient.applicationUnitAssignment.findMany({
        where: { application_id: applicationId },
        select: { person_id: true, unit_id: true, permission_key: true, updated_at: true },
        orderBy: [{ person_id: "asc" }, { unit_id: "asc" }, { permission_key: "asc" }],
      }),
      prismaClient.applicationUnitAssignmentSet.findMany({
        where: { application_id: applicationId },
        select: { unit_id: true, permission_key: true, updated_at: true },
        orderBy: [{ unit_id: "asc" }, { permission_key: "asc" }],
      }),
      prismaClient.applicationPermission.findMany({
        where: { application_id: applicationId, deprecated_at: null },
        select: { key: true, unit_assignment: true },
      }),
      ApplicationEntitlementService.activePersonIds(applicationId),
      prismaClient.application.findUnique({
        where: { application_id: applicationId },
        select: { retired_at: true },
      }),
    ]);
    if (application?.retired_at) return { assignments: [], managedSets: [] };
    const explicitKeys = new Set(
      permissionRows
        .filter((row) => unitAssignmentMetadata(row.unit_assignment)?.mode === "explicit")
        .map((row) => row.key),
    );
    return {
      assignments: assignments.filter(
        (row) => explicitKeys.has(row.permission_key) && activePersonIds.has(row.person_id),
      ),
      managedSets: managedSets.filter((row) => explicitKeys.has(row.permission_key)),
    };
  }
}
