import type { Context } from "hono";
import { z } from "zod";
import { AdminRole } from "../../generated/prisma/client";
import { ResponseError } from "../../error/response-error";
import { prismaClient } from "../../lib/prisma";
import { GoogleWorkspaceService } from "../../service/google-workspace-service";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type { AdminVariables } from "../../type/hono-context";
import { isUnitWritable } from "../../utils/admin-permissions";
import { assertCanWriteNow } from "../../utils/office-hours";
import { isProtectedSuperAdminEmail } from "../../utils/protected-admin";
import { recoveryEmail } from "../../validation/validation";
import { Validation } from "../../validation/validation";

type Kind = "employee" | "intern";

const PROVISION = z.object({ recovery_email: recoveryEmail().optional() });
const CHANGE_RECOVERY = z.object({ recovery_email: recoveryEmail() });

// Three levels. Making or linking an account is for a Super Admin or a Database Admin who may write employees in the
// person's unit. Suspending, restoring and looking at Google again are for Super Admins. Resetting the password and
// changing the recovery email can take an account over, so they are for the protected Super Admins only.
type Admin = Context<{ Variables: AdminVariables }>["var"]["admin"];
type Target = { personId: string; unitId: string };

const isSuperAdmin = (admin: Admin) => admin.role === AdminRole.SUPER_ADMIN;
const isProtected = (admin: Admin) => isSuperAdmin(admin) && isProtectedSuperAdminEmail(admin.email);
const canCreate = (admin: Admin, unitId: string) =>
  isSuperAdmin(admin) ||
  (admin.role === AdminRole.DATABASE_ADMIN && admin.can_write_employee_data && isUnitWritable(admin, unitId, "employee"));

function assertSuperAdmin(c: Context<{ Variables: AdminVariables }>): void {
  if (!isSuperAdmin(c.var.admin)) {
    throw new ResponseError(403, "Forbidden: only a Super Admin can manage Google accounts");
  }
}

function assertProtectedSuperAdmin(c: Context<{ Variables: AdminVariables }>, what: string): void {
  if (!isProtected(c.var.admin)) {
    throw new ResponseError(403, `Forbidden: only a protected Super Admin can ${what}`);
  }
}

async function assertCanCreate(c: Context<{ Variables: AdminVariables }>, target: Target): Promise<void> {
  const admin = c.var.admin;
  if (!canCreate(admin, target.unitId)) {
    throw new ResponseError(403, "Forbidden: you cannot create Google accounts for this person");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) await assertCanWriteNow(admin, getAuditRequestContext(c));
}

async function targetOf(kind: Kind, id: string | undefined): Promise<Target> {
  if (!id) throw new ResponseError(400, "ID is required in parameter");
  const row =
    kind === "employee"
      ? await prismaClient.employee.findFirst({ where: { id, deleted_at: null }, select: { person_id: true, unit_id: true } })
      : await prismaClient.intern.findFirst({ where: { id, deleted_at: null }, select: { person_id: true, unit_id: true } });
  if (!row) throw new ResponseError(404, `${kind === "employee" ? "Employee" : "Intern"} not found`);
  return { personId: row.person_id, unitId: row.unit_id };
}

async function personIdOf(kind: Kind, id: string | undefined): Promise<string> {
  return (await targetOf(kind, id)).personId;
}

export class GoogleAccountController {
  static status(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      const target = await targetOf(kind, c.req.param("id"));
      const admin = c.var.admin;
      // Looking again at Google on demand is for Super Admins.
      const refresh = c.req.query("refresh") === "true" && isSuperAdmin(admin);
      const status = await GoogleWorkspaceService.statusOf(target.personId, { refresh });
      // What this admin may do, so the page only shows those buttons.
      return c.json({
        data: { ...status, can: { create: canCreate(admin, target.unitId), manage: isSuperAdmin(admin), takeover: isProtected(admin) } },
      });
    };
  }

  static provision(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      const target = await targetOf(kind, c.req.param("id"));
      await assertCanCreate(c, target);
      const personId = target.personId;
      const body = await c.req.json().catch(() => ({}));
      const { recovery_email } = Validation.validate(PROVISION, body);
      const result = await GoogleWorkspaceService.provision(personId, {
        recoveryEmail: recovery_email,
        admin: c.var.admin,
        context: getAuditRequestContext(c),
      });
      // 409 when Google already had it and it was linked is not an error: the result says "linked".
      return c.json({ data: result });
    };
  }

  static resetPassword(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertProtectedSuperAdmin(c, "reset a Google password");
      const personId = await personIdOf(kind, c.req.param("id"));
      const { password } = await GoogleWorkspaceService.resetPassword(personId, c.var.admin, getAuditRequestContext(c));
      // Never cached: it is a password.
      c.header("Cache-Control", "no-store");
      return c.json({ data: { password } });
    };
  }

  static restore(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertSuperAdmin(c);
      const personId = await personIdOf(kind, c.req.param("id"));
      const result = await GoogleWorkspaceService.restore(personId, c.var.admin, getAuditRequestContext(c));
      return c.json({ data: result });
    };
  }

  static suspend(kind: Kind, suspended: boolean) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertSuperAdmin(c);
      const personId = await personIdOf(kind, c.req.param("id"));
      const result = await GoogleWorkspaceService.setSuspended(personId, suspended, c.var.admin, getAuditRequestContext(c));
      return c.json({ data: result });
    };
  }

  static recoveryEmail(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertSuperAdmin(c);
      const personId = await personIdOf(kind, c.req.param("id"));
      c.header("Cache-Control", "no-store");
      return c.json({ data: await GoogleWorkspaceService.recoveryEmailOf(personId) });
    };
  }

  static changeRecoveryEmail(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertProtectedSuperAdmin(c, "change a recovery email");
      const personId = await personIdOf(kind, c.req.param("id"));
      const body = await c.req.json().catch(() => ({}));
      const { recovery_email } = Validation.validate(CHANGE_RECOVERY, body);
      await GoogleWorkspaceService.changeRecoveryEmail(personId, recovery_email, c.var.admin, getAuditRequestContext(c));
      return c.json({ data: true });
    };
  }
}
