import {
  AdminRole,
  AuditAction,
  AuditSource,
  EmployeeStatus,
  ApplicationAudience,
  PersonType,
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
  type SetApplicationAccessRuleRequest,
  toApplicationAccessRuleResponse,
  type ApplicationEntitlementResponse,
  type ApplicationRoleResponse,
  type CreateApplicationRoleRequest,
  type ListApplicationRolesRequest,
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
} from "../validation/application-entitlement-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";

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

async function personMatchesRule(
  personId: string,
  rule: { audience: ApplicationAudience; unit_ids: string[] },
): Promise<boolean> {
  const person = await prismaClient.person.findFirst({
    where: { id: personId, deleted_at: null },
    select: {
      person_type: true,
      employee: { select: { status: true, deleted_at: true, unit_id: true } },
      student: {
        select: { status: true, deleted_at: true, current_grade: { select: { unit_id: true } } },
      },
    },
  });
  if (!person) return false;
  const inUnits = (unitId: string | null | undefined) =>
    rule.unit_ids.length === 0 || (unitId != null && rule.unit_ids.includes(unitId));

  if (person.person_type === PersonType.EMPLOYEE) {
    const employee = person.employee;
    return (
      rule.audience !== ApplicationAudience.STUDENTS &&
      employee?.status === EmployeeStatus.ACTIVE &&
      employee.deleted_at === null &&
      inUnits(employee.unit_id)
    );
  }
  if (person.person_type === PersonType.STUDENT) {
    const student = person.student;
    return (
      rule.audience !== ApplicationAudience.EMPLOYEES &&
      student?.status === StudentStatus.ACTIVE &&
      student.deleted_at === null &&
      inUnits(student.current_grade?.unit_id)
    );
  }
  return false;
}

async function resolveBaselineEntitlement(
  personId: string | undefined,
  applicationId: string | undefined,
): Promise<ApplicationEntitlementResponse | null> {
  if (!personId || !applicationId) return null;
  const rule = await prismaClient.applicationAccessRule.findUnique({
    where: { application_id: applicationId },
  });
  if (!rule || !rule.is_active) return null;

  const explicit = await prismaClient.applicationEntitlement.findUnique({
    where: { person_id_application_id: { person_id: personId, application_id: applicationId } },
    select: { id: true },
  });
  if (explicit) return null;

  const role = await prismaClient.applicationRole.findUnique({
    where: { application_id_key: { application_id: applicationId, key: rule.default_role_key } },
  });
  if (!role || !role.is_active) return null;
  if (!(await personMatchesRule(personId, rule))) return null;

  const stamp = (role.updated_at > rule.updated_at ? role.updated_at : rule.updated_at).toISOString();
  return {
    id: `baseline:${applicationId}`,
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
              is_active: true,
              version: { increment: 1 },
              granted_at: new Date(),
            },
          })
        : await tx.applicationEntitlement.create({
            data: {
              person_id: grant.person_id,
              application_id: grant.application_id,
              organization_id: grant.organization_id,
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

    const items = [];
    for (const personId of input.person_ids) {
      try {
        const data = await this.grant(
          admin,
          {
            person_id: personId,
            application_id: input.application_id,
            organization_id: input.organization_id,
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

export class ApplicationRoleService {
  static async list(
    admin: AdminUser,
    request: ListApplicationRolesRequest,
  ): Promise<ApplicationRoleResponse[]> {
    assertSuperAdmin(admin);
    const filters = Validation.validate(ApplicationRoleValidation.LIST, request);
    const roles = await prismaClient.applicationRole.findMany({
      where: filters,
      orderBy: [{ application_id: "asc" }, { key: "asc" }],
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
    const created = await prismaClient.$transaction(async (tx) => {
      const saved = await tx.applicationRole.create({ data: input });
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

export class ApplicationAccessRuleService {
  static async list(admin: AdminUser): Promise<ApplicationAccessRuleResponse[]> {
    assertSuperAdmin(admin);
    const rules = await prismaClient.applicationAccessRule.findMany({
      orderBy: { application_id: "asc" },
    });
    return rules.map(toApplicationAccessRuleResponse);
  }

  // One rule per application: this creates it or replaces it.
  static async set(
    admin: AdminUser,
    request: SetApplicationAccessRuleRequest,
    context: AuditRequestContext = {},
  ): Promise<ApplicationAccessRuleResponse> {
    assertSuperAdmin(admin);
    const validated = Validation.validate(ApplicationAccessRuleValidation.SET, request);
    const input = {
      ...validated,
      unit_ids: validated.unit_ids ?? [],
      is_active: validated.is_active ?? true,
    };

    const role = await prismaClient.applicationRole.findUnique({
      where: {
        application_id_key: { application_id: input.application_id, key: input.default_role_key },
      },
    });
    if (!role || !role.is_active) {
      throw new ResponseError(
        400,
        `Role "${input.default_role_key}" is not an active role of ${input.application_id}`,
      );
    }
    if (input.unit_ids.length > 0) {
      const found = await prismaClient.masterUnit.count({ where: { id: { in: input.unit_ids } } });
      if (found !== input.unit_ids.length) {
        throw new ResponseError(400, "One or more units do not exist");
      }
    }

    const existing = await prismaClient.applicationAccessRule.findUnique({
      where: { application_id: input.application_id },
    });
    const snapshot = (rule: {
      audience: string;
      unit_ids: string[];
      default_role_key: string;
      organization_id: string;
      is_active: boolean;
    }) => ({
      audience: rule.audience,
      unit_ids: rule.unit_ids,
      default_role_key: rule.default_role_key,
      organization_id: rule.organization_id,
      is_active: rule.is_active,
    });

    const saved = await prismaClient.$transaction(async (tx) => {
      const data = {
        audience: input.audience,
        unit_ids: input.unit_ids,
        default_role_key: input.default_role_key,
        organization_id: input.organization_id,
        is_active: input.is_active,
      };
      const rule = existing
        ? await tx.applicationAccessRule.update({ where: { id: existing.id }, data })
        : await tx.applicationAccessRule.create({
            data: { application_id: input.application_id, ...data },
          });
      await AuditService.record(
        {
          action: AuditAction.APPLICATION_ACCESS_RULE_SET,
          source: AuditSource.UI,
          entity_type: "ApplicationAccessRule",
          entity_id: rule.id,
          admin_id: admin.id,
          old_values: existing ? snapshot(existing) : undefined,
          new_values: { application_id: rule.application_id, ...snapshot(rule) },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
      return rule;
    });
    return toApplicationAccessRuleResponse(saved);
  }
}
