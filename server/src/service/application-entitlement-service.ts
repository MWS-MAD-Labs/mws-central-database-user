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
  type ApplicationRoleOptions,
  type ListRoleOptionsRequest,
  type ApplicationScopeCatalog,
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
import { UNKNOWN_LEGACY_UNIT_NAME } from "../utils/legacy-unit";
import {
  buildFeasibility,
  comboKey,
  loadScopeCatalog,
  scopePairFits,
  projection,
  type Feasibility,
  type ScopeCatalog,
} from "./application-scope-rules";
import { AuditService } from "./audit-service";
import {
  assertPermissionDependencies,
  assertPermissionsRegistered,
  loadRequires,
  loadRequiresByApplication,
  missingDependencies,
} from "./application-permission-service";
import {
  loadActiveRules,
  assertHasGroup,
  assertPersonException,
  assertRuleGate,
  checkRuleGate,
  loadGateState,
  loadRuleSubject,
  ruleMatches,
  inheritedRole,
  groupAllowsExceptions,
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
  // Who the role is given to. ANY only checks that the role exists and is active.
  audience: "EMPLOYEE" | "STUDENT" | "ANY" = "EMPLOYEE",
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
  // Own access rows (exceptions) follow who the role is for.
  if (audience === "EMPLOYEE" && !entry.allows_employees) {
    throw new ResponseError(400, `Role "${role}" is not for employees`);
  }
  if (audience === "STUDENT" && !entry.allows_students) {
    throw new ResponseError(400, `Role "${role}" is not for students`);
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

// An employee or a student that can have access rows of their own.
async function findExceptionPerson(
  personId: string,
): Promise<{ id: string; full_name: string; kind: "EMPLOYEE" | "STUDENT" } | null> {
  const person = await prismaClient.person.findFirst({
    where: {
      id: personId,
      deleted_at: null,
      OR: [
        { person_type: PersonType.EMPLOYEE, employee: { status: EmployeeStatus.ACTIVE, deleted_at: null } },
        { person_type: PersonType.STUDENT, student: { status: StudentStatus.ACTIVE, deleted_at: null } },
      ],
    },
    select: { id: true, full_name: true, person_type: true },
  });
  if (!person) return null;
  return {
    id: person.id,
    full_name: person.full_name,
    kind: person.person_type === PersonType.STUDENT ? "STUDENT" : "EMPLOYEE",
  };
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

  const changedAt = role.updated_at > rule.updated_at ? role.updated_at : rule.updated_at;
  const stamp = changedAt.toISOString();
  return {
    id: `group:${rule.id}`,
    person_id: personId,
    application_id: applicationId,
    organization_id: rule.organization_id,
    role: role.key,
    permissions: role.permissions,
    // No counter exists for group access, so the version is the second the role or
    // group last changed: it only goes up, and stays put while nothing changes.
    version: Math.floor(changedAt.getTime() / 1000),
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
          OR: [
            { person_type: PersonType.EMPLOYEE, employee: { status: EmployeeStatus.ACTIVE, deleted_at: null } },
            { person_type: PersonType.STUDENT, student: { status: StudentStatus.ACTIVE, deleted_at: null } },
          ],
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

    const person = await findExceptionPerson(grant.person_id);
    if (!person) {
      throw new ResponseError(404, "Active employee or student not found");
    }

    const rolePermissions = await resolveRolePermissions(
      grant.application_id,
      grant.role,
      grant.permissions,
      person.kind,
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

  // Shuts a person out of an application they would get through a group. The row keeps the
  // role the group gives, switched off, and a row that is off always wins over the group.
  static async blockPerson(
    admin: AdminUser,
    personId: string,
    applicationId: string,
    context: AuditRequestContext = {},
  ): Promise<ApplicationEntitlementResponse> {
    assertSuperAdmin(admin);
    const person = await findExceptionPerson(personId);
    if (!person) throw new ResponseError(404, "Active employee or student not found");

    const rules = await loadActiveRules(applicationId);
    if (person.kind === "EMPLOYEE") assertHasGroup(applicationId, rules);
    const subject = await loadRuleSubject(personId);
    const inherited = subject ? inheritedRole(subject, rules) : undefined;
    if (inherited && person.kind === "STUDENT" && !groupAllowsExceptions(inherited)) {
      throw new ResponseError(
        400,
        "Exceptions are off for this group of students. Turn them on in the group first.",
      );
    }
    if (!inherited) {
      throw new ResponseError(
        400,
        `${person.full_name} is not covered by any group of ${applicationId}, so there is nothing to block.`,
      );
    }

    const existing = await prismaClient.applicationEntitlement.findUnique({
      where: { person_id_application_id: { person_id: personId, application_id: applicationId } },
    });
    if (existing && !existing.is_active) {
      throw new ResponseError(400, `${person.full_name} is already blocked on ${applicationId}`);
    }
    const organizationId = await resolveOrganizationId(applicationId);
    const rolePermissions = existing
      ? existing.permissions
      : (await prismaClient.applicationRole.findUnique({
          where: { application_id_key: { application_id: applicationId, key: inherited.default_role_key } },
          select: { permissions: true },
        }))?.permissions ?? [];

    const saved = await prismaClient.$transaction(async (tx) => {
      const row = existing
        ? await tx.applicationEntitlement.update({
            where: { id: existing.id },
            data: { is_active: false, version: { increment: 1 } },
          })
        : await tx.applicationEntitlement.create({
            data: {
              person_id: personId,
              application_id: applicationId,
              organization_id: organizationId,
              role: inherited.default_role_key,
              permissions: rolePermissions,
              is_active: false,
            },
          });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_REVOKE,
          source: AuditSource.UI,
          entity_type: "ApplicationEntitlement",
          entity_id: row.id,
          admin_id: admin.id,
          old_values: existing ? auditSnapshot(existing) : undefined,
          new_values: auditSnapshot(row),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return row;
    });
    return toApplicationEntitlementResponse(saved);
  }

  static async bulkGrant(
    admin: AdminUser,
    request: BulkGrantApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<BulkActionResponse<ApplicationEntitlementResponse>> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationEntitlementValidation.BULK_GRANT, request);
    // Fail the whole call early on a bad role instead of once per person.
    if (!input.blocked) await resolveRolePermissions(input.application_id, input.role as string, undefined, "ANY");
    const activeRules = await loadActiveRules(input.application_id);
    if (activeRules.length === 0) {
      throw new ResponseError(400, `Set up a group for ${input.application_id} first. It decides who can use the app.`);
    }

    const items = [];
    for (const personId of input.person_ids) {
      try {
        const data = input.blocked
          ? await this.blockPerson(admin, personId, input.application_id, context)
          : await this.grant(
              admin,
              {
                person_id: personId,
                application_id: input.application_id,
                role: input.role as string,
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
    const holder = await findExceptionPerson(existing.person_id);
    const nextPermissions = await resolveRolePermissions(
      existing.application_id,
      nextRole,
      update.permissions,
      holder?.kind ?? "EMPLOYEE",
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
  // Lifts a block. A row that only blocks the group's own role is deleted, so the person is back on
  // group access. An exception that was blocked is switched on again with the role it had.
  static async unblock(
    admin: AdminUser,
    request: RevokeApplicationEntitlementRequest,
    context: AuditRequestContext = {},
  ): Promise<{ id: string; restored: "GROUP_ACCESS" | "EXCEPTION" }> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationEntitlementValidation.REVOKE, request);
    const existing = await prismaClient.applicationEntitlement.findUnique({ where: { id: input.id } });
    if (!existing) throw new ResponseError(404, "Application entitlement not found");
    if (existing.is_active) throw new ResponseError(400, "This person is not blocked");

    const rules = await loadActiveRules(existing.application_id);
    const subject = await loadRuleSubject(existing.person_id);
    const inherited = subject ? inheritedRole(subject, rules) : undefined;

    if (inherited && inherited.default_role_key === existing.role) {
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
      return { id: existing.id, restored: "GROUP_ACCESS" };
    }

    const permissions = await resolveRolePermissions(
      existing.application_id,
      existing.role,
      undefined,
      subject?.kind === "STUDENT" ? "STUDENT" : "EMPLOYEE",
    );
    await assertPersonException(existing.application_id, existing.person_id, existing.role, rules);
    await prismaClient.$transaction(async (tx) => {
      const saved = await tx.applicationEntitlement.update({
        where: { id: existing.id },
        data: { is_active: true, permissions, version: { increment: 1 }, granted_at: new Date() },
      });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ENTITLEMENT_GRANT,
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
    });
    return { id: existing.id, restored: "EXCEPTION" };
  }

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
  allows_employees: boolean;
  allows_students: boolean;
  is_active: boolean;
}) {
  return {
    application_id: role.application_id,
    key: role.key,
    label: role.label,
    permissions: role.permissions,
    allows_employees: role.allows_employees,
    allows_students: role.allows_students,
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
    const groupCounts = await prismaClient.applicationAccessRule.groupBy({
      by: ["application_id", "default_role_key"],
      where: { is_active: true },
      _count: { _all: true },
    });
    const countOf = (role: { application_id: string; key: string }) =>
      counts.find((c) => c.application_id === role.application_id && c.role === role.key)
        ?._count._all ?? 0;
    const groupsOf = (role: { application_id: string; key: string }) =>
      groupCounts.find((c) => c.application_id === role.application_id && c.default_role_key === role.key)
        ?._count._all ?? 0;
    const requires = await loadRequiresByApplication([...new Set(roles.map((role) => role.application_id))]);
    return roles.map((role) =>
      toApplicationRoleResponse(
        role,
        countOf(role),
        groupsOf(role),
        [...new Set(missingDependencies(role.permissions, requires.get(role.application_id) ?? new Map()).map(([, needed]) => needed))],
      ),
    );
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
    await assertPermissionsRegistered(input.application_id, input.permissions);
    await assertPermissionDependencies(input.application_id, input.permissions);
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
        data: {
          ...input,
          allows_employees: input.allows_employees ?? true,
          allows_students: input.allows_students ?? false,
          rank: (lowest._max.rank ?? -1) + 1,
        },
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

  // A role nobody ever used can go. One that people or groups still point at is deactivated instead,
  // so what points at it keeps making sense.
  static async remove(admin: AdminUser, id: string, context: AuditRequestContext = {}): Promise<void> {
    assertSuperAdmin(admin);
    const role = await prismaClient.applicationRole.findUnique({ where: { id } });
    if (!role) throw new ResponseError(404, "Role not found");

    const [people, groups] = await Promise.all([
      prismaClient.applicationEntitlement.count({ where: { application_id: role.application_id, role: role.key } }),
      prismaClient.applicationAccessRule.count({
        where: { application_id: role.application_id, default_role_key: role.key },
      }),
    ]);
    if (people > 0 || groups > 0) {
      const used = [
        people > 0 ? `${people} ${people === 1 ? "person" : "people"}` : null,
        groups > 0 ? `${groups} ${groups === 1 ? "group" : "groups"}` : null,
      ]
        .filter(Boolean)
        .join(" and ");
      throw new ResponseError(
        400,
        `${used} still use this role. Move them to another role first, or deactivate it instead.`,
      );
    }

    await prismaClient.$transaction(async (tx) => {
      await tx.applicationRole.delete({ where: { id } });
      // Keep the order 0..n-1 without a hole.
      const rest = await tx.applicationRole.findMany({
        where: { application_id: role.application_id },
        orderBy: [{ rank: "asc" }, { key: "asc" }],
      });
      for (const [index, item] of rest.entries()) {
        if (item.rank !== index) await tx.applicationRole.update({ where: { id: item.id }, data: { rank: index } });
      }
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ROLE_DELETE,
          source: AuditSource.UI,
          entity_type: "ApplicationRole",
          entity_id: role.id,
          admin_id: admin.id,
          old_values: roleAuditSnapshot(role),
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });
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

    // A group that hands the role out would lose everyone it covers.
    const activeGroups = await prismaClient.applicationAccessRule.count({
      where: { application_id: existing.application_id, default_role_key: existing.key, is_active: true },
    });
    if (input.is_active === false && existing.is_active && activeGroups > 0) {
      throw new ResponseError(
        400,
        `${activeGroups} active group(s) still give this role. Change or turn off those groups first.`,
      );
    }

    // Taking away who a role is for must not strand a group or person that uses it.
    const nextEmployees = input.allows_employees ?? existing.allows_employees;
    const nextStudents = input.allows_students ?? existing.allows_students;
    if (!nextEmployees && !nextStudents) {
      throw new ResponseError(400, "A role has to be for employees, students or both");
    }
    if (existing.allows_students && !nextStudents) {
      const used = await prismaClient.applicationAccessRule.count({
        where: {
          application_id: existing.application_id,
          default_role_key: existing.key,
          is_active: true,
          audience: { in: [ApplicationAudience.STUDENTS, ApplicationAudience.EMPLOYEES_AND_STUDENTS] },
        },
      });
      if (used > 0) {
        throw new ResponseError(400, `${used} active group(s) of students still give this role. Change those groups first.`);
      }
    }
    if (existing.allows_employees && !nextEmployees) {
      const usedByGroups = await prismaClient.applicationAccessRule.count({
        where: {
          application_id: existing.application_id,
          default_role_key: existing.key,
          is_active: true,
          audience: { in: [ApplicationAudience.EMPLOYEES, ApplicationAudience.EMPLOYEES_AND_STUDENTS] },
        },
      });
      if (usedByGroups > 0 || activeCount > 0) {
        throw new ResponseError(400, "Employees still use this role through a group or their own access. Change those first.");
      }
    }

    if (input.permissions !== undefined) {
      await assertPermissionsRegistered(existing.application_id, input.permissions, existing.permissions);
      // An old role that already misses something may keep its permissions as they are.
      const sameSet =
        [...new Set(input.permissions)].sort().join("\n") === [...new Set(existing.permissions)].sort().join("\n");
      if (!sameSet) await assertPermissionDependencies(existing.application_id, input.permissions);
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
          allows_employees: input.allows_employees,
          allows_students: input.allows_students,
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
    const requires = await loadRequires(updated.application_id);
    return toApplicationRoleResponse(updated, activeCount, activeGroups, [
      ...new Set(missingDependencies(updated.permissions, requires).map(([, needed]) => needed)),
    ]);
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

async function assertRuleReferences(
  rule: {
    application_id: string;
    default_role_key: string;
    audience: ApplicationAudience;
    unit_ids: string[];
    job_position_ids: string[];
    job_level_ids: string[];
  },
  // A group saved before the scope rules may keep its old values while only its role or switch changes.
  checkScope = true,
  // Turning a group off does not need its role to be active.
  checkRole = true,
) {
  const role = await prismaClient.applicationRole.findUnique({
    where: { application_id_key: { application_id: rule.application_id, key: rule.default_role_key } },
  });
  if (checkRole && (!role || !role.is_active)) {
    throw new ResponseError(400, `Role "${rule.default_role_key}" is not an active role of ${rule.application_id}`);
  }
  if (checkRole && role) {
    const forEmployees = rule.audience !== ApplicationAudience.STUDENTS;
    const forStudents = rule.audience !== ApplicationAudience.EMPLOYEES;
    if (forEmployees && !role.allows_employees) {
      throw new ResponseError(400, `Role "${role.key}" is not for employees`);
    }
    if (forStudents && !role.allows_students) {
      throw new ResponseError(400, `Role "${role.key}" is not for students`);
    }
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
  if (rule.unit_ids.length) {
    const legacy = await prismaClient.masterUnit.count({
      where: { id: { in: rule.unit_ids }, name: UNKNOWN_LEGACY_UNIT_NAME },
    });
    if (legacy > 0) throw new ResponseError(400, `${UNKNOWN_LEGACY_UNIT_NAME} is not a real unit`);
  }
  if (positions !== rule.job_position_ids.length) throw new ResponseError(400, "One or more job positions do not exist");
  if (levels !== rule.job_level_ids.length) throw new ResponseError(400, "One or more job levels do not exist");
  if (checkScope && rule.audience !== ApplicationAudience.STUDENTS) await assertScopeCanHoldPeople(rule);
  // Students only exist in units that have grades.
  if (checkScope && rule.audience === ApplicationAudience.STUDENTS && rule.unit_ids.length > 0) {
    const withGrades = await prismaClient.grade.findMany({
      where: { unit_id: { in: rule.unit_ids } },
      distinct: ["unit_id"],
      select: { unit_id: true },
    });
    const has = new Set(withGrades.map((grade) => grade.unit_id));
    const missing = rule.unit_ids.find((id) => !has.has(id));
    if (missing) {
      const unit = await prismaClient.masterUnit.findUnique({ where: { id: missing }, select: { name: true } });
      throw new ResponseError(400, `Unit "${unit?.name ?? missing}" has no students`);
    }
  }
}

// Every value of a scope must be able to hold someone, by the master data rules:
// positions and levels limited to units, and positions that fit the level.
async function assertScopeCanHoldPeople(rule: ScopeIds) {
  const catalog = await loadScopeCatalog();
  const used = projection(buildFeasibility(catalog).combos(rule));
  const check = (ids: string[], seen: Set<string>, list: { id: string; name: string }[], label: string, against: string) => {
    const dead = ids.find((id) => !seen.has(id));
    if (dead) {
      const name = list.find((item) => item.id === dead)?.name ?? dead;
      throw new ResponseError(400, `${label} "${name}" does not apply to the selected ${against}`);
    }
  };
  check(rule.job_position_ids, used.positions, catalog.positions, "Job position", "units and levels");
  check(rule.job_level_ids, used.levels, catalog.levels, "Job level", "units and job positions");
  check(rule.unit_ids, used.units, catalog.units, "Unit", "job positions and levels");
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
  allows_exceptions: boolean;
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
    allows_exceptions: rule.allows_exceptions,
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
  allows_exceptions?: boolean;
}): GateRule {
  return {
    id: rule.id,
    audience: rule.audience,
    unit_ids: rule.unit_ids,
    job_position_ids: rule.job_position_ids,
    job_level_ids: rule.job_level_ids,
    default_role_key: rule.default_role_key,
    is_active: rule.is_active,
    allows_exceptions: rule.allows_exceptions,
  };
}

// Turning exceptions off must not strand students who already have one.
async function assertNoStudentExceptions(applicationId: string, rule: GateRule) {
  const [rules, rows] = await Promise.all([
    loadActiveRules(applicationId),
    prismaClient.applicationEntitlement.findMany({
      where: { application_id: applicationId, person: { person_type: PersonType.STUDENT } },
      select: { person_id: true },
    }),
  ]);
  let inside = 0;
  for (const row of rows) {
    const subject = await loadRuleSubject(row.person_id);
    if (subject && inheritedRole(subject, rules)?.id === rule.id) inside += 1;
  }
  if (inside > 0) {
    throw new ResponseError(
      400,
      `${inside} ${inside === 1 ? "student has" : "students have"} an exception in this group. Remove ${inside === 1 ? "it" : "them"} first.`,
    );
  }
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
      // Only a group of students needs the flag.
      allows_exceptions: validated.audience === "STUDENTS" ? (validated.allows_exceptions ?? false) : false,
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
      allows_exceptions:
        existing.audience === "STUDENTS" ? (input.allows_exceptions ?? existing.allows_exceptions) : false,
    };
    if (existing.allows_exceptions && !next.allows_exceptions && existing.audience === "STUDENTS") {
      await assertNoStudentExceptions(existing.application_id, toGateRule(existing));
    }
    await assertRuleReferences(
      next,
      input.unit_ids !== undefined || input.job_position_ids !== undefined || input.job_level_ids !== undefined,
      next.is_active,
    );
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
          allows_exceptions: next.allows_exceptions,
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
type ScopeIds = Pick<GateRule, "unit_ids" | "job_position_ids" | "job_level_ids">;

const employeeScope = (rule: ScopeIds): Prisma.EmployeeWhereInput => ({
  ...(rule.unit_ids.length ? { unit_id: { in: rule.unit_ids } } : {}),
  ...(rule.job_position_ids.length ? { job_position_id: { in: rule.job_position_ids } } : {}),
  ...(rule.job_level_ids.length ? { job_level_id: { in: rule.job_level_ids } } : {}),
});

const studentScope = (rule: ScopeIds): Prisma.StudentWhereInput =>
  rule.unit_ids.length ? { current_grade: { unit_id: { in: rule.unit_ids } } } : {};

// What is left of each dimension of a group once its narrower groups took theirs,
// worked out on the triples the master data lets exist.
function remainingScope(
  group: GateRule,
  children: GateRule[],
  catalog: ScopeCatalog,
  feasibility: Feasibility,
): ApplicationGroupCard["remaining"] {
  const named = <T extends { id: string; name: string }>(list: T[], ids: Set<string>) =>
    list.filter((item) => ids.has(item.id)).map((item) => ({ id: item.id, name: item.name }));
  const unitsOf = (rule: GateRule) =>
    rule.unit_ids.length ? catalog.units.filter((unit) => rule.unit_ids.includes(unit.id)) : catalog.units;
  const withEmployees = (rule: GateRule) => rule.audience !== ApplicationAudience.STUDENTS;
  const withStudents = (rule: GateRule) => rule.audience !== ApplicationAudience.EMPLOYEES;

  // Employees: the feasible triples, minus those a narrower group holds.
  const all = withEmployees(group) ? feasibility.combos(group) : [];
  const taken = new Set(
    children.filter(withEmployees).flatMap((child) => feasibility.combos(child).map(comboKey)),
  );
  const left = all.filter((item) => !taken.has(comboKey(item)));
  const before = projection(all);
  const after = projection(left);

  // Students only have a unit, so a narrower group takes the units it lists.
  let studentBefore = new Set<string>();
  let studentAfter = new Set<string>();
  if (withStudents(group)) {
    studentBefore = new Set(unitsOf(group).map((unit) => unit.id));
    const takers = children.filter(withStudents);
    studentAfter = new Set(
      [...studentBefore].filter((id) => !takers.some((child) => !child.unit_ids.length || child.unit_ids.includes(id))),
    );
  }

  const dimension = (
    list: { id: string; name: string }[],
    beforeIds: Set<string>,
    afterIds: Set<string>,
  ) => {
    const dropped = [...beforeIds].filter((id) => !afterIds.has(id));
    if (dropped.length === 0) return null;
    return { kept: named(list, afterIds), dropped: named(list, new Set(dropped)) };
  };
  return {
    units: dimension(
      catalog.units,
      new Set([...before.units, ...studentBefore]),
      new Set([...after.units, ...studentAfter]),
    ),
    job_positions: withEmployees(group) ? dimension(catalog.positions, before.positions, after.positions) : null,
    job_levels: withEmployees(group) ? dimension(catalog.levels, before.levels, after.levels) : null,
  };
}

export class ApplicationAccessService {
  // Ids of the applications set up in Application Access, for other services to check an id against.
  static async applicationIds(): Promise<string[]> {
    const [roles, organizations, groups] = await Promise.all([
      prismaClient.applicationRole.findMany({ distinct: ["application_id"], select: { application_id: true } }),
      prismaClient.applicationOrganization.findMany({ select: { application_id: true } }),
      prismaClient.applicationAccessRule.findMany({ distinct: ["application_id"], select: { application_id: true } }),
    ]);
    return [...new Set([...roles, ...organizations, ...groups].map((row) => row.application_id))].sort();
  }

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
                select: {
                  status: true,
                  deleted_at: true,
                  nis: true,
                  current_grade: { select: { unit_id: true, name: true, unit: { select: { name: true } } } },
                  current_class: { select: { name: true } },
                },
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
      allows_exceptions: rule.allows_exceptions,
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

    const catalog = await loadScopeCatalog();
    const feasibility = buildFeasibility(catalog);
    const [allUnits, positions, levels] = await Promise.all([
      prismaClient.masterUnit.findMany({ select: { id: true, name: true } }),
      prismaClient.masterJobPosition.findMany({ select: { id: true, name: true } }),
      prismaClient.masterJobLevel.findMany({ select: { id: true, name: true } }),
    ]);
    const units = allUnits;
    const named = (list: { id: string; name: string }[], ids: string[]) =>
      ids.map((id) => ({ id, name: list.find((item) => item.id === id)?.name ?? id }));

    // Active groups sitting directly under each group.
    const childrenOf = (rule: (typeof rules)[number]) =>
      rule.is_active
        ? gateRules.filter((candidate) => candidate.id !== rule.id && parentRule(candidate, active)?.id === rule.id)
        : [];
    const counts = await Promise.all(
      rules.map(async (rule) => {
        const children = childrenOf(rule);
        const employeeChildren = children.filter((child) => child.audience !== ApplicationAudience.STUDENTS);
        const studentChildren = children.filter((child) => child.audience !== ApplicationAudience.EMPLOYEES);
        const employeeWhere = { status: EmployeeStatus.ACTIVE, deleted_at: null, ...employeeScope(rule) };
        const studentWhere = { status: StudentStatus.ACTIVE, deleted_at: null, ...studentScope(rule) };
        const withEmployees = rule.audience !== ApplicationAudience.STUDENTS;
        const withStudents = rule.audience !== ApplicationAudience.EMPLOYEES;
        const [employees, ownEmployees, students, ownStudents] = await Promise.all([
          withEmployees ? prismaClient.employee.count({ where: employeeWhere }) : 0,
          withEmployees
            ? prismaClient.employee.count({
                where: employeeChildren.length
                  ? { ...employeeWhere, NOT: { OR: employeeChildren.map(employeeScope) } }
                  : employeeWhere,
              })
            : 0,
          withStudents ? prismaClient.student.count({ where: studentWhere }) : 0,
          withStudents
            ? prismaClient.student.count({
                where: studentChildren.length
                  ? { ...studentWhere, NOT: { OR: studentChildren.map(studentScope) } }
                  : studentWhere,
              })
            : 0,
        ]);
        return { covered: employees + students, own: ownEmployees + ownStudents };
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
          covered_count: counts[index].covered,
          own_count: counts[index].own,
          remaining: remainingScope(gateRules[index], childrenOf(rule), catalog, feasibility),
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

  // The master data a scope picker needs to work out what fits together:
  // positions and levels with the units they exist in, and which pairs match.
  static async scopeCatalog(admin: AdminUser): Promise<ApplicationScopeCatalog> {
    assertSuperAdmin(admin);
    const catalog = await loadScopeCatalog();
    const pairs: Record<string, string[]> = {};
    for (const position of catalog.positions) {
      pairs[position.id] = catalog.levels
        .filter((level) => scopePairFits(position, level))
        .map((level) => level.id);
    }
    const grades = await prismaClient.grade.findMany({ distinct: ["unit_id"], select: { unit_id: true } });
    const shown = new Set(catalog.units.map((unit) => unit.id));
    return {
      units: catalog.units,
      job_positions: catalog.positions.map((item) => ({ id: item.id, name: item.name, unit_ids: item.unit_ids })),
      job_levels: catalog.levels.map((item) => ({ id: item.id, name: item.name, unit_ids: item.unit_ids })),
      pairs,
      student_unit_ids: grades.map((grade) => grade.unit_id).filter((id) => shown.has(id)),
    };
  }

  // Which roles a group with this scope cannot take, by the same rules as saving it.
  static async roleOptions(
    admin: AdminUser,
    applicationId: string,
    request: ListRoleOptionsRequest,
  ): Promise<ApplicationRoleOptions> {
    assertSuperAdmin(admin);
    const input = Validation.validate(ApplicationAccessRuleValidation.ROLE_OPTIONS, request);
    const [state, roles] = await Promise.all([
      loadGateState(applicationId),
      prismaClient.applicationRole.findMany({
        where: { application_id: applicationId, is_active: true },
        select: { key: true, allows_employees: true, allows_students: true },
      }),
    ]);
    const previous = input.group_id ? (state.before.find((rule) => rule.id === input.group_id) ?? null) : null;
    const unavailable: ApplicationRoleOptions["unavailable"] = [];
    for (const role of roles) {
      // A role is for employees, students or both, and a group can only hand out what fits.
      if (input.audience !== ApplicationAudience.STUDENTS && !role.allows_employees) {
        unavailable.push({ role: role.key, reason: "Not for employees" });
        continue;
      }
      if (input.audience !== ApplicationAudience.EMPLOYEES && !role.allows_students) {
        unavailable.push({ role: role.key, reason: "Not for students" });
        continue;
      }
      try {
        checkRuleGate(
          state,
          previous,
          {
            id: previous?.id ?? "new",
            audience: input.audience,
            unit_ids: input.unit_ids ?? [],
            job_position_ids: input.job_position_ids ?? [],
            job_level_ids: input.job_level_ids ?? [],
            default_role_key: role.key,
            is_active: true,
          },
          { roleOnly: true },
        );
      } catch (error) {
        if (!(error instanceof ResponseError)) throw error;
        unavailable.push({ role: role.key, reason: error.message });
      }
    }
    return { unavailable };
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
      kind: row.person.person_type === PersonType.STUDENT ? "STUDENT" : "EMPLOYEE",
      nis: row.person.student?.nis ?? null,
      grade: row.person.student?.current_grade?.name ?? null,
      class_name: row.person.student?.current_class?.name ?? null,
      full_name: row.person.full_name,
      email: row.person.email,
      unit: row.person.employee?.unit.name ?? row.person.student?.current_grade?.unit?.name ?? null,
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

  // The students of one group of students, to pick the ones who get an exception.
  private static async studentCandidates(
    filters: {
      application_id: string;
      exclude_own_access?: boolean;
      unit_id?: string;
      grade_id?: string;
      class_id?: string;
      search?: string;
    },
    group: GateRule,
    rules: GateRule[],
    page: number,
    size: number,
  ): Promise<Pageable<ApplicationCandidate>> {
    if (!groupAllowsExceptions(group)) {
      throw new ResponseError(400, "Exceptions are off for this group of students. Turn them on in the group first.");
    }
    const studentRules = rules.filter((rule) => rule.audience === ApplicationAudience.STUDENTS);
    const fragment = (rule: GateRule): Prisma.StudentWhereInput =>
      rule.unit_ids.length ? { current_grade: { unit_id: { in: rule.unit_ids } } } : {};
    // Students of a narrower group belong to that group.
    const narrower = studentRules.filter((rule) => rule.id !== group.id && parentRule(rule, rules)?.id === group.id);
    const where: Prisma.StudentWhereInput = {
      status: StudentStatus.ACTIVE,
      deleted_at: null,
      AND: [
        fragment(group),
        ...(narrower.length ? [{ NOT: { OR: narrower.map(fragment) } }] : []),
        ...(filters.unit_id ? [{ current_grade: { unit_id: filters.unit_id } }] : []),
        ...(filters.grade_id ? [{ current_grade_id: filters.grade_id }] : []),
        ...(filters.class_id ? [{ current_class_id: filters.class_id }] : []),
        ...(filters.exclude_own_access
          ? [{ person: { application_entitlements: { none: { application_id: filters.application_id } } } }]
          : []),
        ...(filters.search
          ? [
              {
                OR: [
                  { person: { full_name: { contains: filters.search, mode: "insensitive" as const } } },
                  { person: { email: { contains: filters.search, mode: "insensitive" as const } } },
                  { nis: { contains: filters.search, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
    };
    return paginate(page, size, {
      count: () => prismaClient.student.count({ where }),
      findMany: async () => {
        const students = await prismaClient.student.findMany({
          where,
          include: {
            person: { select: { id: true, full_name: true, email: true } },
            current_grade: { select: { name: true, unit: { select: { name: true } } } },
            current_class: { select: { name: true } },
          },
          orderBy: [{ person: { full_name: "asc" } }, { id: "asc" }],
          skip: (page - 1) * size,
          take: size,
        });
        const own = await prismaClient.applicationEntitlement.findMany({
          where: {
            application_id: filters.application_id,
            person_id: { in: students.map((student) => student.person_id) },
          },
          select: { person_id: true, role: true, is_active: true },
        });
        return students.map((student) => {
          const ownRow = own.find((row) => row.person_id === student.person_id);
          return {
            person_id: student.person_id,
            kind: "STUDENT" as const,
            nis: student.nis,
            grade: student.current_grade.name,
            class_name: student.current_class?.name ?? null,
            employee_id: "",
            full_name: student.person.full_name,
            email: student.person.email,
            unit: student.current_grade.unit?.name ?? "",
            job_position: "",
            job_level: "",
            employment_type: "",
            inherited_role: group.default_role_key,
            inherited_group_id: group.id,
            own_access: ownRow ? { role: ownRow.role, is_active: ownRow.is_active } : null,
          };
        });
      },
    });
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
    if (coverage === "GROUP") {
      const studentGroup = rules.find((rule) => rule.id === filters.group_id && rule.audience === ApplicationAudience.STUDENTS);
      if (studentGroup) return this.studentCandidates(filters, studentGroup, rules, page, size);
    }
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
      // People of a narrower group belong to that group, so they are left out here.
      const narrower = employeeRules.filter(
        (rule) => rule.id !== group.id && parentRule(rule, rules)?.id === group.id,
      );
      coverageWhere = narrower.length
        ? { AND: [fragment(group), { NOT: { OR: narrower.map(fragment) } }] }
        : fragment(group);
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
