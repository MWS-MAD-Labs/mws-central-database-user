import { randomBytes } from "crypto";
import {
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  EmploymentType,
  ApplicationAudience,
  PersonType,
  Prisma,
  StudentStatus,
  type AdminUser,
  type ApplicationEntitlement,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toApplicationEntitlementResponse,
  type ApplicationEntitlementLookupRequest,
  type ApplicationAccessRuleResponse,
  type ApplicationEntitlementListItem,
  type BulkGrantApplicationEntitlementRequest,
  type ApplicationAccessRow,
  type CreateApplicationAccessRuleRequest,
  type DeleteApplicationAccessRuleRequest,
  type ListApplicationAccessRequest,
  type ListApplicationCandidatesRequest,
  type ApplicationCandidate,
  type ApplicationDetail,
  type ApplicationExceptionRow,
  type ApplicationGroupCard,
  type ApplicationSummary,
  type CreateApplicationRequest,
  type ListApplicationExceptionsRequest,
  type ListApplicationsRequest,
  type UpdateApplicationAccessRuleRequest,
  toApplicationAccessRuleResponse,
  type ApplicationEntitlementResponse,
  type ApplicationRoleResponse,
  type CreateApplicationRoleRequest,
  type ListApplicationRolesRequest,
  type ReorderApplicationRolesRequest,
  toApplicationRoleResponse,
  type UpdateApplicationRoleRequest,
  type GrantApplicationEntitlementRequest,
  type ListApplicationEntitlementsRequest,
  type RevokeApplicationEntitlementRequest,
  type UpdateApplicationEntitlementRequest,
} from "../model/application-entitlement-model";
import { paginate, type Pageable } from "../model/page-model";
import type { ApiClientVariables } from "../type/hono-context";
import { toBulkActionResponse, type BulkActionResponse } from "../model/bulk-action-model";
import {
  ApplicationAccessRuleValidation,
  ApplicationEntitlementValidation,
  ApplicationRoleValidation,
  ApplicationValidation,
} from "../validation/application-entitlement-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";
import {
  loadActiveRules,
  assertHasGroup,
  assertPersonException,
  assertRuleGate,
  loadRuleSubject,
  ruleMatches,
  inheritedRole,
  parentRule,
  toRuleSubject,
  ruleSpecificity,
  type GateRule,
  type RuleFilter,
} from "./application-access-gate";

function assertSuperAdmin(admin: AdminUser) {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    throw new ResponseError(
      403,
      "Forbidden: Only Super Admin can manage application entitlements",
    );
  }
}

function auditSnapshot(entitlement: ApplicationEntitlement) {
  return {
    person_id: entitlement.person_id,
    application_id: entitlement.application_id,
    organization_id: entitlement.organization_id,
    role: entitlement.role,
    permissions: entitlement.permissions,
    version: entitlement.version,
    is_active: entitlement.is_active,
  };
}

function generateOrganizationId(applicationId: string): string {
  return `org_${applicationId.replace(/-/g, "_")}_${randomBytes(3).toString("hex")}`;
}

// One organization per application, created the first time it is needed and
// never typed by hand.
export async function resolveOrganizationId(applicationId: string): Promise<string> {
  const existing = await prismaClient.applicationOrganization.findUnique({
    where: { application_id: applicationId },
  });
  if (existing) return existing.organization_id;
  try {
    const created = await prismaClient.applicationOrganization.create({
      data: { application_id: applicationId, organization_id: generateOrganizationId(applicationId) },
    });
    return created.organization_id;
  } catch {
    // Another request created it first.
    const winner = await prismaClient.applicationOrganization.findUniqueOrThrow({
      where: { application_id: applicationId },
    });
    return winner.organization_id;
  }
}

// The registry decides what a role may do. Keys match exactly, no mapping.
async function resolveRolePermissions(
  applicationId: string,
  role: string,
  permissions: string[] | undefined,
): Promise<string[]> {
  const entry = await prismaClient.applicationRole.findUnique({
    where: { application_id_key: { application_id: applicationId, key: role } },
  });
  if (!entry || !entry.is_active) {
    throw new ResponseError(
      400,
      `Role "${role}" is not an active role of ${applicationId}. Use a role from the registry, spelled exactly.`,
    );
  }
  if (permissions !== undefined) {
    const same =
      permissions.length === entry.permissions.length &&
      entry.permissions.every((permission) => permissions.includes(permission));
    if (!same) {
      throw new ResponseError(400, `Permissions must match the ${role} role of ${applicationId}`);
    }
  }
  return entry.permissions;
}

async function resolveBaselineEntitlement(
  personId: string | undefined,
  applicationId: string | undefined,
): Promise<ApplicationEntitlementResponse | null> {
  if (!personId || !applicationId) return null;
  const rules = await prismaClient.applicationAccessRule.findMany({
    where: { application_id: applicationId, is_active: true },
  });
  if (rules.length === 0) return null;

  const explicit = await prismaClient.applicationEntitlement.findUnique({
    where: { person_id_application_id: { person_id: personId, application_id: applicationId } },
    select: { id: true },
  });
  if (explicit) return null;

  const subject = await loadRuleSubject(personId);
  if (!subject) return null;
  // The most specific matching rule wins. Saving a rule rejects overlaps, so
  // there is never a tie.
  const rule = rules
    .filter((candidate) => ruleMatches(candidate, subject))
    .sort((left, right) => ruleSpecificity(right) - ruleSpecificity(left))[0];
  if (!rule) return null;

  const role = await prismaClient.applicationRole.findUnique({
    where: { application_id_key: { application_id: applicationId, key: rule.default_role_key } },
  });
  if (!role || !role.is_active) return null;

  const stamp = (role.updated_at > rule.updated_at ? role.updated_at : rule.updated_at).toISOString();
  return {
    id: `group:${rule.id}`,
    person_id: personId,
    application_id: applicationId,
    organization_id: rule.organization_id,
    role: role.key,
    permissions: role.permissions,
    version: 0,
    is_active: true,
    granted_at: rule.created_at.toISOString(),
    updated_at: stamp,
    is_default: true,
  };
}

export class ApplicationEntitlementService {
  static async lookup(
    client: ApiClientVariables,
    request: ApplicationEntitlementLookupRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationEntitlementResponse> {
    const lookup = Validation.validate(
      ApplicationEntitlementValidation.LOOKUP,
      request,
    );

    const entitlement = await prismaClient.applicationEntitlement.findFirst({
      where: {
        person_id: lookup.person_id,
        application_id: lookup.application_id,
        is_active: true,
        person: {
          deleted_at: null,
          person_type: PersonType.EMPLOYEE,
          employee: { status: EmployeeStatus.ACTIVE, deleted_at: null },
        },
      },
      orderBy: { updated_at: "desc" },
    });

    // No explicit row: fall back to the application's baseline rule, unless an
    // explicit (revoked) row exists, which means someone chose to deny access.
    const baseline = entitlement
      ? null
      : await resolveBaselineEntitlement(lookup.person_id, lookup.application_id);

    await AuditService.record({
      action: AuditAction.API_ACCESS,
      source: AuditSource.API,
      api_client_id: client.clientId,
      entity_type: "ApplicationEntitlement",
      entity_id: entitlement?.id,
      new_values: {
        requested_person_id: lookup.person_id ?? null,
        requested_application_id: lookup.application_id ?? null,
        found: entitlement !== null || baseline !== null,
        via_baseline_rule: baseline !== null,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    if (entitlement) return toApplicationEntitlementResponse(entitlement);
    if (baseline) return baseline;
    throw new ResponseError(404, "Active application entitlement not found");
  }

  static async grant(
    admin: AdminUser,
    request: GrantApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationEntitlementResponse> {
    assertSuperAdmin(admin);
    const grant = Validation.validate(
      ApplicationEntitlementValidation.GRANT,
      request,
    );

    const person = await prismaClient.person.findFirst({
      where: {
        id: grant.person_id,
        deleted_at: null,
        person_type: PersonType.EMPLOYEE,
        employee: { status: EmployeeStatus.ACTIVE, deleted_at: null },
      },
      select: { id: true },
    });
    if (!person) {
      throw new ResponseError(404, "Active employee person not found");
    }

    const rolePermissions = await resolveRolePermissions(
      grant.application_id,
      grant.role,
      grant.permissions,
    );

    await assertPersonException(
      grant.application_id,
      grant.person_id,
      grant.role,
      await loadActiveRules(grant.application_id),
    );
    const organizationId = await resolveOrganizationId(grant.application_id);

    const existing = await prismaClient.applicationEntitlement.findUnique({
      where: {
        person_id_application_id: {
          person_id: grant.person_id,
          application_id: grant.application_id,
        },
      },
    });
    if (existing?.is_active) {
      throw new ResponseError(400, "Application entitlement already exists");
    }

    const entitlement = await prismaClient.$transaction(async (tx) => {
      const saved = existing
        ? await tx.applicationEntitlement.update({
            where: { id: existing.id },
            data: {
              role: grant.role,
              permissions: rolePermissions,
              organization_id: organizationId,
              is_active: true,
              version: { increment: 1 },
              granted_at: new Date(),
            },
          })
        : await tx.applicationEntitlement.create({
            data: {
              person_id: grant.person_id,
              application_id: grant.application_id,
              organization_id: organizationId,
              role: grant.role,
              permissions: rolePermissions,
            },
          });

      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_GRANT,
          source: AuditSource.UI,
          entity_type: "ApplicationEntitlement",
          entity_id: saved.id,
          admin_id: admin.id,
          old_values: existing ? auditSnapshot(existing) : undefined,
          new_values: auditSnapshot(saved),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return saved;
    });

    return toApplicationEntitlementResponse(entitlement);
  }

  static async bulkGrant(
    admin: AdminUser,
    request: BulkGrantApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkActionResponse<ApplicationEntitlementResponse>> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationEntitlementValidation.BULK_GRANT, request);
    // Fail the whole call early on a bad role instead of once per person.
    await resolveRolePermissions(input.application_id, input.role, undefined);
    assertHasGroup(input.application_id, await loadActiveRules(input.application_id));

    const items = [];
    for (const personId of input.person_ids) {
      try {
        const data = await this.grant(
          admin,
          {
            person_id: personId,
            application_id: input.application_id,
            role: input.role,
          },
          context,
        );
        items.push({ id: personId, status: "SUCCESS" as const, data });
      } catch (error) {
        items.push({
          id: personId,
          status: "FAILED" as const,
          error: error instanceof ResponseError ? error.message : "Could not grant access",
        });
      }
    }
    return toBulkActionResponse(items);
  }

  static async update(
    admin: AdminUser,
    request: UpdateApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationEntitlementResponse> {
    assertSuperAdmin(admin);
    const update = Validation.validate(
      ApplicationEntitlementValidation.UPDATE,
      request,
    );
    const existing = await prismaClient.applicationEntitlement.findUnique({
      where: { id: update.id },
    });
    if (!existing) throw new ResponseError(404, "Application entitlement not found");
    if (!existing.is_active) {
      throw new ResponseError(400, "Cannot update a revoked application entitlement");
    }
    const nextRole = update.role ?? existing.role;
    if (nextRole !== existing.role) {
      await assertPersonException(
        existing.application_id,
        existing.person_id,
        nextRole,
        await loadActiveRules(existing.application_id),
      );
    }
    const nextPermissions = await resolveRolePermissions(
      existing.application_id,
      nextRole,
      update.permissions,
    );

    const entitlement = await prismaClient.$transaction(async (tx) => {
      const saved = await tx.applicationEntitlement.update({
        where: { id: update.id },
        data: {
          role: nextRole,
          permissions: nextPermissions,
          version: { increment: 1 },
        },
      });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_UPDATE,
          source: AuditSource.UI,
          entity_type: "ApplicationEntitlement",
          entity_id: saved.id,
          admin_id: admin.id,
          old_values: auditSnapshot(existing),
          new_values: auditSnapshot(saved),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return saved;
    });

    return toApplicationEntitlementResponse(entitlement);
  }

  static async revoke(
    admin: AdminUser,
    request: RevokeApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationEntitlementResponse> {
    assertSuperAdmin(admin);
    const revoke = Validation.validate(
      ApplicationEntitlementValidation.REVOKE,
      request,
    );
    const existing = await prismaClient.applicationEntitlement.findUnique({
      where: { id: revoke.id },
    });
    if (!existing) throw new ResponseError(404, "Application entitlement not found");
    if (!existing.is_active) {
      throw new ResponseError(400, "Application entitlement is already revoked");
    }

    const entitlement = await prismaClient.$transaction(async (tx) => {
      const saved = await tx.applicationEntitlement.update({
        where: { id: revoke.id },
        data: { is_active: false, version: { increment: 1 } },
      });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_REVOKE,
          source: AuditSource.UI,
          entity_type: "ApplicationEntitlement",
          entity_id: saved.id,
          admin_id: admin.id,
          old_values: auditSnapshot(existing),
          new_values: auditSnapshot(saved),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return saved;
    });

    return toApplicationEntitlementResponse(entitlement);
  }

  // Deletes the person's own access row: they fall back to group access, if any.
  static async remove(
    admin: AdminUser,
    request: RevokeApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationEntitlementValidation.REVOKE, request);
    const existing = await prismaClient.applicationEntitlement.findUnique({ where: { id: input.id } });
    if (!existing) throw new ResponseError(404, "Application entitlement not found");
    await prismaClient.$transaction(async (tx) => {
      await tx.applicationEntitlement.delete({ where: { id: existing.id } });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_DELETE,
          source: AuditSource.UI,
          entity_type: "ApplicationEntitlement",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: auditSnapshot(existing),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
    return true;
  }

  static async list(
    admin: AdminUser,
    request: ListApplicationEntitlementsRequest,
  ): Promise<Pageable<ApplicationEntitlementListItem>> {
    assertSuperAdmin(admin);
    const filters = Validation.validate(
      ApplicationEntitlementValidation.LIST,
      request,
    );
    const { page: pageInput, size: sizeInput, search, ...exact } = filters;
    const page = pageInput ?? 1;
    const size = sizeInput ?? 10;
    const where = {
      ...exact,
      ...(search
        ? {
            person: {
              OR: [
                { full_name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    };
    return paginate(page, size, {
      count: () => prismaClient.applicationEntitlement.count({ where }),
      findMany: async () => {
        const rows = await prismaClient.applicationEntitlement.findMany({
          where,
          include: {
            person: {
              select: {
                full_name: true,
                email: true,
                employee: { select: { unit: { select: { name: true } } } },
              },
            },
          },
          orderBy: [{ updated_at: "desc" }, { id: "desc" }],
          skip: (page - 1) * size,
          take: size,
        });
        return rows.map((row) => ({
          ...toApplicationEntitlementResponse(row),
          person: {
            full_name: row.person.full_name,
            email: row.person.email,
            unit: row.person.employee?.unit.name ?? null,
          },
        }));
      },
    });
  }
}

function roleAuditSnapshot(role: {
  application_id: string;
  key: string;
  label: string;
  permissions: string[];
  is_active: boolean;
}) {
  return {
    application_id: role.application_id,
    key: role.key,
    label: role.label,
    permissions: role.permissions,
    is_active: role.is_active,
  };
}

// An application should not hold two active roles with the same permissions.
async function assertDistinctPermissions(
  applicationId: string,
  permissions: string[],
  excludeId?: string,
) {
  const wanted = [...new Set(permissions)].sort().join("\n");
  const roles = await prismaClient.applicationRole.findMany({
    where: { application_id: applicationId, is_active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { key: true, permissions: true },
  });
  const twin = roles.find((role) => [...new Set(role.permissions)].sort().join("\n") === wanted);
  if (twin) {
    throw new ResponseError(
      400,
      `Role ${twin.key} already has the same permissions. Reuse it instead of adding another.`,
    );
  }
}

export class ApplicationRoleService {
  static async list(
    admin: AdminUser,
    request: ListApplicationRolesRequest,
  ): Promise<ApplicationRoleResponse[]> {
    assertSuperAdmin(admin);
    const filters = Validation.validate(ApplicationRoleValidation.LIST, request);
    const roles = await prismaClient.applicationRole.findMany({
      where: filters,
      orderBy: [{ application_id: "asc" }, { rank: "asc" }, { key: "asc" }],
    });
    const counts = await prismaClient.applicationEntitlement.groupBy({
      by: ["application_id", "role"],
      where: { is_active: true },
      _count: { _all: true },
    });
    const countOf = (role: { application_id: string; key: string }) =>
      counts.find((c) => c.application_id === role.application_id && c.role === role.key)
        ?._count._all ?? 0;
    return roles.map((role) => toApplicationRoleResponse(role, countOf(role)));
  }

  static async create(
    admin: AdminUser,
    request: CreateApplicationRoleRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationRoleResponse> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationRoleValidation.CREATE, request);
    const existing = await prismaClient.applicationRole.findUnique({
      where: { application_id_key: { application_id: input.application_id, key: input.key } },
    });
    if (existing) {
      throw new ResponseError(400, `Role ${input.key} already exists for ${input.application_id}`);
    }
    await assertDistinctPermissions(input.application_id, input.permissions);
    // A new application gets its organization together with its first role.
    await resolveOrganizationId(input.application_id);
    const created = await prismaClient.$transaction(async (tx) => {
      // A new role starts at the bottom of the application.
      const lowest = await tx.applicationRole.aggregate({
        where: { application_id: input.application_id },
        _max: { rank: true },
      });
      const saved = await tx.applicationRole.create({
        data: { ...input, rank: (lowest._max.rank ?? -1) + 1 },
      });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ROLE_CREATE,
          source: AuditSource.UI,
          entity_type: "ApplicationRole",
          entity_id: saved.id,
          admin_id: admin.id,
          new_values: roleAuditSnapshot(saved),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return saved;
    });
    return toApplicationRoleResponse(created, 0);
  }

  // Puts the roles of one application in order, highest first.
  static async reorder(
    admin: AdminUser,
    request: ReorderApplicationRolesRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationRoleResponse[]> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationRoleValidation.ORDER, request);
    const roles = await prismaClient.applicationRole.findMany({
      where: { application_id: input.application_id },
    });
    const known = new Set(roles.map((role) => role.id));
    if (input.role_ids.length !== roles.length || input.role_ids.some((id) => !known.has(id))) {
      throw new ResponseError(400, "Send every role of this application, once each");
    }
    await prismaClient.$transaction(async (tx) => {
      for (const [index, id] of input.role_ids.entries()) {
        const before = roles.find((role) => role.id === id)!;
        if (before.rank === index) continue;
        await tx.applicationRole.update({ where: { id }, data: { rank: index } });
        await AuditService.record(
          {
            action: AuditAction.APPLICATION_ROLE_UPDATE,
            source: AuditSource.UI,
            entity_type: "ApplicationRole",
            entity_id: id,
            admin_id: admin.id,
            old_values: { rank: before.rank },
            new_values: { rank: index },
            ip_address: context.ip_address,
            user_agent: context.user_agent,
          },
          tx,
        );
      }
    });
    return this.list(admin, { application_id: input.application_id });
  }

  // Changing a role's permissions also updates every active entitlement that
  // holds it, so the registry stays the single source of truth.
  static async update(
    admin: AdminUser,
    request: UpdateApplicationRoleRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationRoleResponse> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationRoleValidation.UPDATE, request);
    const existing = await prismaClient.applicationRole.findUnique({ where: { id: input.id } });
    if (!existing) throw new ResponseError(404, "Application role not found");

    const activeCount = await prismaClient.applicationEntitlement.count({
      where: { application_id: existing.application_id, role: existing.key, is_active: true },
    });
    if (input.is_active === false && existing.is_active && activeCount > 0) {
      throw new ResponseError(
        400,
        `${activeCount} active entitlement(s) still use this role. Move or revoke them first.`,
      );
    }

    const willBeActive = input.is_active ?? existing.is_active;
    const permissionsChanged =
      input.permissions !== undefined &&
      [...new Set(input.permissions)].sort().join("\n") !==
        [...new Set(existing.permissions)].sort().join("\n");
    const activating = input.is_active === true && !existing.is_active;
    if (willBeActive && (permissionsChanged || activating)) {
      await assertDistinctPermissions(
        existing.application_id,
        input.permissions ?? existing.permissions,
        existing.id,
      );
    }

    const updated = await prismaClient.$transaction(async (tx) => {
      const saved = await tx.applicationRole.update({
        where: { id: input.id },
        data: {
          label: input.label,
          permissions: input.permissions,
          is_active: input.is_active,
        },
      });
      if (input.permissions !== undefined) {
        await tx.applicationEntitlement.updateMany({
          where: { application_id: existing.application_id, role: existing.key, is_active: true },
          data: { permissions: input.permissions, version: { increment: 1 } },
        });
      }
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ROLE_UPDATE,
          source: AuditSource.UI,
          entity_type: "ApplicationRole",
          entity_id: saved.id,
          admin_id: admin.id,
          old_values: roleAuditSnapshot(existing),
          new_values: roleAuditSnapshot(saved),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return saved;
    });
    return toApplicationRoleResponse(updated, activeCount);
  }
}

const AUDIENCE_APPLIES_TO_EMPLOYEES = new Set<ApplicationAudience>([
  ApplicationAudience.EMPLOYEES,
  ApplicationAudience.EMPLOYEES_AND_STUDENTS,
]);
const AUDIENCE_APPLIES_TO_STUDENTS = new Set<ApplicationAudience>([
  ApplicationAudience.STUDENTS,
  ApplicationAudience.EMPLOYEES_AND_STUDENTS,
]);

function intersects(left: string[], right: string[]) {
  return left.some((id) => right.includes(id));
}

// Two active rules of one application may not both match the same person with
// the same specificity, otherwise the winner would be arbitrary.
async function assertNoOverlap(
  applicationId: string,
  candidate: RuleFilter,
  excludeId?: string,
) {
  const others = await prismaClient.applicationAccessRule.findMany({
    where: { application_id: applicationId, is_active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  for (const other of others) {
    if (ruleSpecificity(other) !== ruleSpecificity(candidate)) continue;
    const sharesEmployees =
      AUDIENCE_APPLIES_TO_EMPLOYEES.has(other.audience) && AUDIENCE_APPLIES_TO_EMPLOYEES.has(candidate.audience);
    const sharesStudents =
      AUDIENCE_APPLIES_TO_STUDENTS.has(other.audience) && AUDIENCE_APPLIES_TO_STUDENTS.has(candidate.audience);
    // Positions and levels only exist for employees, so students only share units.
    const overlapsFor = (dimensions: { a: string[]; b: string[] }[]) =>
      dimensions.every(({ a, b }) => (a.length === 0 && b.length === 0) || intersects(a, b));
    const employeeOverlap =
      sharesEmployees &&
      overlapsFor([
        { a: other.unit_ids, b: candidate.unit_ids },
        { a: other.job_position_ids, b: candidate.job_position_ids },
        { a: other.job_level_ids, b: candidate.job_level_ids },
      ]);
    const studentOverlap =
      sharesStudents && overlapsFor([{ a: other.unit_ids, b: candidate.unit_ids }]);
    if (employeeOverlap || studentOverlap) {
      throw new ResponseError(
        400,
        "Another active group access already covers the same people. Narrow one of them so they do not overlap.",
      );
    }
  }
}

async function assertRuleReferences(rule: {
  application_id: string;
  default_role_key: string;
  audience: ApplicationAudience;
  unit_ids: string[];
  job_position_ids: string[];
  job_level_ids: string[];
}) {
  const role = await prismaClient.applicationRole.findUnique({
    where: { application_id_key: { application_id: rule.application_id, key: rule.default_role_key } },
  });
  if (!role || !role.is_active) {
    throw new ResponseError(400, `Role "${rule.default_role_key}" is not an active role of ${rule.application_id}`);
  }
  if (
    rule.audience === ApplicationAudience.STUDENTS &&
    (rule.job_position_ids.length > 0 || rule.job_level_ids.length > 0)
  ) {
    throw new ResponseError(400, "Job positions and job levels only apply to employees");
  }
  const [units, positions, levels] = await Promise.all([
    rule.unit_ids.length ? prismaClient.masterUnit.count({ where: { id: { in: rule.unit_ids } } }) : 0,
    rule.job_position_ids.length
      ? prismaClient.masterJobPosition.count({ where: { id: { in: rule.job_position_ids } } })
      : 0,
    rule.job_level_ids.length
      ? prismaClient.masterJobLevel.count({ where: { id: { in: rule.job_level_ids } } })
      : 0,
  ]);
  if (units !== rule.unit_ids.length) throw new ResponseError(400, "One or more units do not exist");
  if (positions !== rule.job_position_ids.length) throw new ResponseError(400, "One or more job positions do not exist");
  if (levels !== rule.job_level_ids.length) throw new ResponseError(400, "One or more job levels do not exist");
}

function ruleAuditSnapshot(rule: {
  application_id: string;
  audience: string;
  unit_ids: string[];
  job_position_ids: string[];
  job_level_ids: string[];
  default_role_key: string;
  organization_id: string;
  is_active: boolean;
}) {
  return {
    application_id: rule.application_id,
    audience: rule.audience,
    unit_ids: rule.unit_ids,
    job_position_ids: rule.job_position_ids,
    job_level_ids: rule.job_level_ids,
    default_role_key: rule.default_role_key,
    organization_id: rule.organization_id,
    is_active: rule.is_active,
  };
}

function toGateRule(rule: {
  id: string;
  audience: ApplicationAudience;
  unit_ids: string[];
  job_position_ids: string[];
  job_level_ids: string[];
  default_role_key: string;
  is_active: boolean;
}): GateRule {
  return {
    id: rule.id,
    audience: rule.audience,
    unit_ids: rule.unit_ids,
    job_position_ids: rule.job_position_ids,
    job_level_ids: rule.job_level_ids,
    default_role_key: rule.default_role_key,
    is_active: rule.is_active,
  };
}

export class ApplicationOrganizationService {
  static async list(admin: AdminUser) {
    assertSuperAdmin(admin);
    const rows = await prismaClient.applicationOrganization.findMany({
      orderBy: { application_id: "asc" },
    });
    return rows.map((row) => ({
      application_id: row.application_id,
      organization_id: row.organization_id,
    }));
  }
}

export class ApplicationAccessRuleService {
  static async get(admin: AdminUser, id: string): Promise<ApplicationAccessRuleResponse> {
    assertSuperAdmin(admin);
    const rule = await prismaClient.applicationAccessRule.findUnique({ where: { id } });
    if (!rule) throw new ResponseError(404, "Group access not found");
    return toApplicationAccessRuleResponse(rule);
  }

  static async create(
    admin: AdminUser,
    request: CreateApplicationAccessRuleRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationAccessRuleResponse> {
    assertSuperAdmin(admin);
    const validated = Validation.validate(ApplicationAccessRuleValidation.CREATE, request);
    const input = {
      ...validated,
      unit_ids: validated.unit_ids ?? [],
      job_position_ids: validated.job_position_ids ?? [],
      job_level_ids: validated.job_level_ids ?? [],
      is_active: validated.is_active ?? true,
    };
    await assertRuleReferences(input);
    if (input.is_active) await assertNoOverlap(input.application_id, input);
    await assertRuleGate(input.application_id, null, {
      id: "new",
      audience: input.audience,
      unit_ids: input.unit_ids,
      job_position_ids: input.job_position_ids,
      job_level_ids: input.job_level_ids,
      default_role_key: input.default_role_key,
      is_active: input.is_active,
    });
    const organizationId = await resolveOrganizationId(input.application_id);

    const saved = await prismaClient.$transaction(async (tx) => {
      const rule = await tx.applicationAccessRule.create({
        data: { ...input, organization_id: organizationId },
      });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ACCESS_RULE_CREATE,
          source: AuditSource.UI,
          entity_type: "ApplicationAccessRule",
          entity_id: rule.id,
          admin_id: admin.id,
          new_values: ruleAuditSnapshot(rule),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return rule;
    });
    return toApplicationAccessRuleResponse(saved);
  }

  static async update(
    admin: AdminUser,
    request: UpdateApplicationAccessRuleRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationAccessRuleResponse> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationAccessRuleValidation.UPDATE, request);
    const existing = await prismaClient.applicationAccessRule.findUnique({ where: { id: input.id } });
    if (!existing) throw new ResponseError(404, "Group access not found");

    const next = {
      application_id: existing.application_id,
      audience: existing.audience,
      unit_ids: input.unit_ids ?? existing.unit_ids,
      job_position_ids: input.job_position_ids ?? existing.job_position_ids,
      job_level_ids: input.job_level_ids ?? existing.job_level_ids,
      default_role_key: input.default_role_key ?? existing.default_role_key,
      is_active: input.is_active ?? existing.is_active,
    };
    await assertRuleReferences(next);
    if (next.is_active) await assertNoOverlap(existing.application_id, next, existing.id);
    await assertRuleGate(existing.application_id, toGateRule(existing), {
      id: existing.id,
      audience: next.audience,
      unit_ids: next.unit_ids,
      job_position_ids: next.job_position_ids,
      job_level_ids: next.job_level_ids,
      default_role_key: next.default_role_key,
      is_active: next.is_active,
    });

    const saved = await prismaClient.$transaction(async (tx) => {
      const rule = await tx.applicationAccessRule.update({
        where: { id: existing.id },
        data: {
          unit_ids: next.unit_ids,
          job_position_ids: next.job_position_ids,
          job_level_ids: next.job_level_ids,
          default_role_key: next.default_role_key,
          is_active: next.is_active,
        },
      });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ACCESS_RULE_UPDATE,
          source: AuditSource.UI,
          entity_type: "ApplicationAccessRule",
          entity_id: rule.id,
          admin_id: admin.id,
          old_values: ruleAuditSnapshot(existing),
          new_values: ruleAuditSnapshot(rule),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return rule;
    });
    return toApplicationAccessRuleResponse(saved);
  }

  static async remove(
    admin: AdminUser,
    request: DeleteApplicationAccessRuleRequest,
    context: AuditRequestContext = {},
  ): Promise<boolean> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationAccessRuleValidation.DELETE, request);
    const existing = await prismaClient.applicationAccessRule.findUnique({ where: { id: input.id } });
    if (!existing) throw new ResponseError(404, "Group access not found");
    await assertRuleGate(existing.application_id, toGateRule(existing), null);
    await prismaClient.$transaction(async (tx) => {
      await tx.applicationAccessRule.delete({ where: { id: existing.id } });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ACCESS_RULE_DELETE,
          source: AuditSource.UI,
          entity_type: "ApplicationAccessRule",
          entity_id: existing.id,
          admin_id: admin.id,
          old_values: ruleAuditSnapshot(existing),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
    return true;
  }
}

// One list for the Access page: group rules first, then people.
export class ApplicationAccessService {
  // One row per application with how much access it has, paged.
  static async applications(
    admin: AdminUser,
    request: ListApplicationsRequest = {},
  ): Promise<Pageable<ApplicationSummary>> {
    assertSuperAdmin(admin);
    const filters = Validation.validate(ApplicationValidation.LIST, request);
    const page = filters.page ?? 1;
    const size = filters.size ?? 10;

    const [roles, organizations, groups, exceptions, blocked, ruleDates, entitlementDates] = await Promise.all([
      prismaClient.applicationRole.groupBy({
        by: ["application_id"],
        _count: { _all: true },
        _max: { updated_at: true },
      }),
      prismaClient.applicationOrganization.findMany(),
      prismaClient.applicationAccessRule.groupBy({
        by: ["application_id"],
        where: { is_active: true },
        _count: { _all: true },
      }),
      prismaClient.applicationEntitlement.groupBy({
        by: ["application_id"],
        where: { is_active: true },
        _count: { _all: true },
      }),
      prismaClient.applicationEntitlement.groupBy({
        by: ["application_id"],
        where: { is_active: false },
        _count: { _all: true },
      }),
      prismaClient.applicationAccessRule.groupBy({ by: ["application_id"], _max: { updated_at: true } }),
      prismaClient.applicationEntitlement.groupBy({ by: ["application_id"], _max: { updated_at: true } }),
    ]);
    const ids = new Set([
      ...roles.map((row) => row.application_id),
      ...organizations.map((row) => row.application_id),
      ...groups.map((row) => row.application_id),
      ...exceptions.map((row) => row.application_id),
      ...blocked.map((row) => row.application_id),
    ]);
    const needle = filters.search?.toLowerCase();
    const all: ApplicationSummary[] = [...ids]
      .filter((id) => !needle || id.includes(needle))
      .sort()
      .map((applicationId) => {
        const organization = organizations.find((row) => row.application_id === applicationId);
        const dates = [
          roles.find((row) => row.application_id === applicationId)?._max.updated_at,
          ruleDates.find((row) => row.application_id === applicationId)?._max.updated_at,
          entitlementDates.find((row) => row.application_id === applicationId)?._max.updated_at,
          organization?.updated_at,
        ].filter((date): date is Date => Boolean(date));
        const latest = dates.sort((left, right) => right.getTime() - left.getTime())[0];
        return {
          application_id: applicationId,
          organization_id: organization?.organization_id ?? null,
          role_count: roles.find((row) => row.application_id === applicationId)?._count._all ?? 0,
          active_group_count: groups.find((row) => row.application_id === applicationId)?._count._all ?? 0,
          exception_count: exceptions.find((row) => row.application_id === applicationId)?._count._all ?? 0,
          blocked_count: blocked.find((row) => row.application_id === applicationId)?._count._all ?? 0,
          updated_at: latest ? latest.toISOString() : null,
        };
      });

    return {
      data: all.slice((page - 1) * size, page * size),
      paging: {
        size,
        current_page: page,
        total_page: Math.ceil(all.length / size),
        total_item: all.length,
      },
    };
  }

  // A new application gets its Organization ID right away. Roles come after.
  static async createApplication(
    admin: AdminUser,
    request: CreateApplicationRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationSummary> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationValidation.CREATE, request);
    const [organization, roles, rules, entitlements] = await Promise.all([
      prismaClient.applicationOrganization.count({ where: { application_id: input.application_id } }),
      prismaClient.applicationRole.count({ where: { application_id: input.application_id } }),
      prismaClient.applicationAccessRule.count({ where: { application_id: input.application_id } }),
      prismaClient.applicationEntitlement.count({ where: { application_id: input.application_id } }),
    ]);
    if (organization + roles + rules + entitlements > 0) {
      throw new ResponseError(400, `Application ${input.application_id} already exists`);
    }
    await resolveOrganizationId(input.application_id);
    const organizationRow = await prismaClient.applicationOrganization.findUniqueOrThrow({
      where: { application_id: input.application_id },
    });
    const organizationId = organizationRow.organization_id;
    await AuditService.record({
      action: AuditAction.APPLICATION_CREATE,
      source: AuditSource.UI,
      entity_type: "ApplicationOrganization",
      entity_id: organizationRow.id,
      admin_id: admin.id,
      new_values: { application_id: input.application_id, organization_id: organizationId },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });
    return {
      application_id: input.application_id,
      organization_id: organizationId,
      role_count: 0,
      active_group_count: 0,
      exception_count: 0,
      blocked_count: 0,
      updated_at: new Date().toISOString(),
    };
  }

  // Rules, and each entitlement with the group that is its parent (or null).
  private static async loadApplicationState(applicationId: string) {
    const [rules, entitlements] = await Promise.all([
      prismaClient.applicationAccessRule.findMany({
        where: { application_id: applicationId },
        orderBy: { created_at: "asc" },
      }),
      prismaClient.applicationEntitlement.findMany({
        where: { application_id: applicationId },
        include: {
          person: {
            select: {
              person_type: true,
              full_name: true,
              email: true,
              student: {
                select: { status: true, deleted_at: true, current_grade: { select: { unit_id: true } } },
              },
              employee: {
                select: {
                  status: true,
                  deleted_at: true,
                  unit_id: true,
                  job_position_id: true,
                  job_level_id: true,
                  employment_type: true,
                  unit: { select: { name: true } },
                  job_position: { select: { name: true } },
                  job_level: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: [{ updated_at: "desc" }, { id: "asc" }],
      }),
    ]);
    const gateRules: GateRule[] = rules.map((rule) => ({
      id: rule.id,
      audience: rule.audience,
      unit_ids: rule.unit_ids,
      job_position_ids: rule.job_position_ids,
      job_level_ids: rule.job_level_ids,
      default_role_key: rule.default_role_key,
      is_active: rule.is_active,
    }));
    const active = gateRules.filter((rule) => rule.is_active);
    const parents = entitlements.map((row) => {
      const subject = toRuleSubject(row.person);
      return { row, parentId: subject ? (inheritedRole(subject, active)?.id ?? null) : null };
    });
    return { rules, gateRules, active, parents };
  }

  // The groups of one application with how many exceptions each holds.
  static async application(admin: AdminUser, applicationId: string): Promise<ApplicationDetail> {
    assertSuperAdmin(admin);
    const [state, organization, roles] = await Promise.all([
      this.loadApplicationState(applicationId),
      prismaClient.applicationOrganization.findUnique({ where: { application_id: applicationId } }),
      prismaClient.applicationRole.findMany({ where: { application_id: applicationId } }),
    ]);
    const { rules, gateRules, active, parents } = state;
    if (rules.length === 0 && parents.length === 0 && roles.length === 0 && !organization) {
      throw new ResponseError(404, "Application not found");
    }

    const [units, positions, levels] = await Promise.all([
      prismaClient.masterUnit.findMany({
        where: { id: { in: rules.flatMap((rule) => rule.unit_ids) } },
        select: { id: true, name: true },
      }),
      prismaClient.masterJobPosition.findMany({
        where: { id: { in: rules.flatMap((rule) => rule.job_position_ids) } },
        select: { id: true, name: true },
      }),
      prismaClient.masterJobLevel.findMany({
        where: { id: { in: rules.flatMap((rule) => rule.job_level_ids) } },
        select: { id: true, name: true },
      }),
    ]);
    const named = (list: { id: string; name: string }[], ids: string[]) =>
      ids.map((id) => ({ id, name: list.find((item) => item.id === id)?.name ?? id }));

    const covered = await Promise.all(
      rules.map(async (rule) => {
        const employees =
          rule.audience === ApplicationAudience.STUDENTS
            ? 0
            : await prismaClient.employee.count({
                where: {
                  status: EmployeeStatus.ACTIVE,
                  deleted_at: null,
                  ...(rule.unit_ids.length ? { unit_id: { in: rule.unit_ids } } : {}),
                  ...(rule.job_position_ids.length ? { job_position_id: { in: rule.job_position_ids } } : {}),
                  ...(rule.job_level_ids.length ? { job_level_id: { in: rule.job_level_ids } } : {}),
                },
              });
        const students =
          rule.audience === ApplicationAudience.EMPLOYEES
            ? 0
            : await prismaClient.student.count({
                where: {
                  status: StudentStatus.ACTIVE,
                  deleted_at: null,
                  ...(rule.unit_ids.length ? { current_grade: { unit_id: { in: rule.unit_ids } } } : {}),
                },
              });
        return employees + students;
      }),
    );

    const groups: ApplicationGroupCard[] = rules
      .map((rule, index) => {
        const inside = parents.filter((item) => item.parentId === rule.id);
        return {
          ...toApplicationAccessRuleResponse(rule),
          parent_group_id: rule.is_active ? (parentRule(gateRules[index], active)?.id ?? null) : null,
          units: named(units, rule.unit_ids),
          job_positions: named(positions, rule.job_position_ids),
          job_levels: named(levels, rule.job_level_ids),
          permissions: roles.find((role) => role.key === rule.default_role_key)?.permissions ?? [],
          exception_count: inside.filter((item) => item.row.is_active).length,
          blocked_count: inside.filter((item) => !item.row.is_active).length,
          covered_count: covered[index],
        };
      })
      // Broad groups first, then narrower ones.
      .sort(
        (left, right) =>
          ruleSpecificity(gateRules.find((rule) => rule.id === left.id)!) -
          ruleSpecificity(gateRules.find((rule) => rule.id === right.id)!),
      );

    return {
      application_id: applicationId,
      organization_id: organization?.organization_id ?? null,
      groups,
      other_count: parents.filter((item) => item.parentId === null).length,
    };
  }

  // The exceptions of one group (or the older access no group covers), paged.
  static async exceptions(
    admin: AdminUser,
    applicationId: string,
    request: ListApplicationExceptionsRequest,
  ): Promise<Pageable<ApplicationExceptionRow>> {
    assertSuperAdmin(admin);
    const filters = Validation.validate(ApplicationValidation.EXCEPTIONS, request);
    const page = filters.page ?? 1;
    const size = filters.size ?? 10;
    const { rules, parents } = await this.loadApplicationState(applicationId);
    if (filters.group_id !== "other" && !rules.some((rule) => rule.id === filters.group_id)) {
      throw new ResponseError(404, "Group access not found");
    }
    const needle = filters.search?.toLowerCase();
    const wanted = filters.group_id === "other" ? null : filters.group_id;
    const matching = parents
      .filter((item) => item.parentId === wanted)
      .filter(
        (item) =>
          !needle ||
          item.row.person.full_name.toLowerCase().includes(needle) ||
          item.row.person.email.toLowerCase().includes(needle),
      )
      // Active first, then by name.
      .sort(
        (left, right) =>
          Number(right.row.is_active) - Number(left.row.is_active) ||
          left.row.person.full_name.localeCompare(right.row.person.full_name),
      );
    const rows: ApplicationExceptionRow[] = matching.slice((page - 1) * size, page * size).map(({ row }) => ({
      id: row.id,
      person_id: row.person_id,
      full_name: row.person.full_name,
      email: row.person.email,
      unit: row.person.employee?.unit.name ?? null,
      job_position: row.person.employee?.job_position.name ?? null,
      job_level: row.person.employee?.job_level.name ?? null,
      employment_type: row.person.employee?.employment_type ?? null,
      role: row.role,
      permissions: row.permissions,
      is_active: row.is_active,
      granted_at: row.granted_at.toISOString(),
    }));
    return {
      data: rows,
      paging: {
        size,
        current_page: page,
        total_page: Math.ceil(matching.length / size),
        total_item: matching.length,
      },
    };
  }

  // Active employees to pick from, filterable by how the application's groups cover them.
  static async candidates(
    admin: AdminUser,
    request: ListApplicationCandidatesRequest,
  ): Promise<Pageable<ApplicationCandidate>> {
    assertSuperAdmin(admin);
    const filters = Validation.validate(ApplicationAccessRuleValidation.CANDIDATES, request);
    const page = filters.page ?? 1;
    const size = filters.size ?? 10;
    const coverage = filters.coverage ?? "ANY";

    const rules = await loadActiveRules(filters.application_id);
    const employeeRules = rules.filter((rule) => rule.audience !== ApplicationAudience.STUDENTS);
    const fragment = (rule: GateRule): Prisma.EmployeeWhereInput => ({
      ...(rule.unit_ids.length ? { unit_id: { in: rule.unit_ids } } : {}),
      ...(rule.job_position_ids.length ? { job_position_id: { in: rule.job_position_ids } } : {}),
      ...(rule.job_level_ids.length ? { job_level_id: { in: rule.job_level_ids } } : {}),
    });

    let coverageWhere: Prisma.EmployeeWhereInput = {};
    if (coverage === "GROUP") {
      const group = employeeRules.find((rule) => rule.id === filters.group_id);
      if (!group) throw new ResponseError(404, "Group access not found");
      coverageWhere = fragment(group);
    } else if (coverage === "COVERED") {
      coverageWhere = employeeRules.length ? { OR: employeeRules.map(fragment) } : { id: "none" };
    } else if (coverage === "UNCOVERED" && employeeRules.length) {
      coverageWhere = { NOT: { OR: employeeRules.map(fragment) } };
    }

    const where: Prisma.EmployeeWhereInput = {
      status: EmployeeStatus.ACTIVE,
      deleted_at: null,
      ...(filters.unit_ids?.length
        ? { unit_id: { in: filters.unit_ids } }
        : filters.unit_id
          ? { unit_id: filters.unit_id }
          : {}),
      ...(filters.job_position_ids?.length
        ? { job_position_id: { in: filters.job_position_ids } }
        : filters.job_position_id
          ? { job_position_id: filters.job_position_id }
          : {}),
      ...(filters.job_level_ids?.length
        ? { job_level_id: { in: filters.job_level_ids } }
        : filters.job_level_id
          ? { job_level_id: filters.job_level_id }
          : {}),
      ...(filters.employment_type ? { employment_type: filters.employment_type as EmploymentType } : {}),
      ...(filters.search
        ? {
            OR: [
              { person: { full_name: { contains: filters.search, mode: "insensitive" } } },
              { person: { email: { contains: filters.search, mode: "insensitive" } } },
              { employee_id: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
      AND: [
        coverageWhere,
        ...(filters.exclude_own_access
          ? [{ person: { application_entitlements: { none: { application_id: filters.application_id } } } }]
          : []),
      ],
    };

    return paginate(page, size, {
      count: () => prismaClient.employee.count({ where }),
      findMany: async () => {
        const employees = await prismaClient.employee.findMany({
          where,
          include: {
            person: { select: { id: true, full_name: true, email: true } },
            unit: { select: { name: true } },
            job_position: { select: { name: true } },
            job_level: { select: { name: true } },
          },
          orderBy: [{ person: { full_name: "asc" } }, { id: "asc" }],
          skip: (page - 1) * size,
          take: size,
        });
        const own = await prismaClient.applicationEntitlement.findMany({
          where: {
            application_id: filters.application_id,
            person_id: { in: employees.map((employee) => employee.person_id) },
          },
          select: { person_id: true, role: true, is_active: true },
        });
        return employees.map((employee) => {
          const inherited = inheritedRole(
            {
              kind: "EMPLOYEE",
              unitId: employee.unit_id,
              positionId: employee.job_position_id,
              levelId: employee.job_level_id,
            },
            rules,
          );
          const ownRow = own.find((row) => row.person_id === employee.person_id);
          return {
            person_id: employee.person_id,
            employee_id: employee.employee_id,
            full_name: employee.person.full_name,
            email: employee.person.email,
            unit: employee.unit.name,
            job_position: employee.job_position.name,
            job_level: employee.job_level.name,
            employment_type: employee.employment_type,
            inherited_role: inherited?.default_role_key ?? null,
            inherited_group_id: inherited?.id ?? null,
            own_access: ownRow ? { role: ownRow.role, is_active: ownRow.is_active } : null,
          };
        });
      },
    });
  }

  static async list(
    admin: AdminUser,
    request: ListApplicationAccessRequest,
  ): Promise<Pageable<ApplicationAccessRow>> {
    assertSuperAdmin(admin);
    const filters = Validation.validate(ApplicationAccessRuleValidation.LIST, request);
    const page = filters.page ?? 1;
    const size = filters.size ?? 10;
    const skip = (page - 1) * size;
    const search = filters.search;

    const ruleWhere = filters.kind === "PERSON" ? null : {
      ...(filters.application_id ? { application_id: filters.application_id } : {}),
      ...(filters.role ? { default_role_key: filters.role } : {}),
      ...(filters.is_active !== undefined ? { is_active: filters.is_active } : {}),
      ...(search ? { application_id: { contains: search, mode: "insensitive" as const } } : {}),
    };
    const personWhere = filters.kind === "GROUP" ? null : {
      ...(filters.application_id ? { application_id: filters.application_id } : {}),
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.is_active !== undefined ? { is_active: filters.is_active } : {}),
      ...(search
        ? {
            person: {
              OR: [
                { full_name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    };

    const rules = ruleWhere
      ? await prismaClient.applicationAccessRule.findMany({
          where: ruleWhere,
          orderBy: [{ application_id: "asc" }, { created_at: "asc" }],
        })
      : [];
    const peopleCount = personWhere
      ? await prismaClient.applicationEntitlement.count({ where: personWhere })
      : 0;

    const ruleSlice = rules.slice(skip, skip + size);
    const remaining = size - ruleSlice.length;
    const peopleSkip = Math.max(skip - rules.length, 0);
    const people =
      personWhere && remaining > 0
        ? await prismaClient.applicationEntitlement.findMany({
            where: personWhere,
            include: {
              person: {
                select: {
                  full_name: true,
                  email: true,
                  employee: { select: { unit: { select: { name: true } } } },
                },
              },
            },
            orderBy: [{ updated_at: "desc" }, { id: "desc" }],
            skip: peopleSkip,
            take: remaining,
          })
        : [];

    const [units, positions, levels, roles] = await Promise.all([
      prismaClient.masterUnit.findMany({
        where: { id: { in: ruleSlice.flatMap((rule) => rule.unit_ids) } },
        select: { id: true, name: true },
      }),
      prismaClient.masterJobPosition.findMany({
        where: { id: { in: ruleSlice.flatMap((rule) => rule.job_position_ids) } },
        select: { id: true, name: true },
      }),
      prismaClient.masterJobLevel.findMany({
        where: { id: { in: ruleSlice.flatMap((rule) => rule.job_level_ids) } },
        select: { id: true, name: true },
      }),
      prismaClient.applicationRole.findMany({
        where: { OR: ruleSlice.map((rule) => ({ application_id: rule.application_id, key: rule.default_role_key })) },
        select: { application_id: true, key: true, permissions: true },
      }),
    ]);
    const named = (list: { id: string; name: string }[], ids: string[]) =>
      ids.map((id) => ({ id, name: list.find((item) => item.id === id)?.name ?? id }));

    const groupRows: ApplicationAccessRow[] = ruleSlice.map((rule) => ({
      kind: "GROUP",
      id: rule.id,
      application_id: rule.application_id,
      role: rule.default_role_key,
      permissions:
        roles.find((role) => role.application_id === rule.application_id && role.key === rule.default_role_key)
          ?.permissions ?? [],
      organization_id: rule.organization_id,
      is_active: rule.is_active,
      granted_at: rule.created_at.toISOString(),
      updated_at: rule.updated_at.toISOString(),
      group: {
        audience: rule.audience,
        units: named(units, rule.unit_ids),
        job_positions: named(positions, rule.job_position_ids),
        job_levels: named(levels, rule.job_level_ids),
      },
      person: null,
    }));
    const personRows: ApplicationAccessRow[] = people.map((row) => ({
      kind: "PERSON",
      id: row.id,
      application_id: row.application_id,
      role: row.role,
      permissions: row.permissions,
      organization_id: row.organization_id,
      is_active: row.is_active,
      granted_at: row.granted_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      group: null,
      person: {
        person_id: row.person_id,
        full_name: row.person.full_name,
        email: row.person.email,
        unit: row.person.employee?.unit.name ?? null,
      },
    }));

    const total = rules.length + peopleCount;
    return {
      data: [...groupRows, ...personRows],
      paging: {
        size,
        current_page: page,
        total_page: Math.ceil(total / size),
        total_item: total,
      },
    };
  }
}
