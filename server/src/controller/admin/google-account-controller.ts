import type { Context } from "hono";
import { z } from "zod";
import { AdminRole } from "../../generated/prisma/client";
import { ResponseError } from "../../error/response-error";
import { prismaClient } from "../../lib/prisma";
import { GoogleWorkspaceService } from "../../service/google-workspace-service";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type { AdminVariables } from "../../type/hono-context";
import { recoveryEmail } from "../../validation/validation";
import { Validation } from "../../validation/validation";

type Kind = "employee" | "intern";

const PROVISION = z.object({ recovery_email: recoveryEmail().optional() });

// Making an account and resetting its password are for Super Admins. The status is readable by anyone who can open
// the person.
function assertSuperAdmin(c: Context<{ Variables: AdminVariables }>): void {
  if (c.var.admin.role !== AdminRole.SUPER_ADMIN) {
    throw new ResponseError(403, "Forbidden: only a Super Admin can manage Google accounts");
  }
}

async function personIdOf(kind: Kind, id: string | undefined): Promise<string> {
  if (!id) throw new ResponseError(400, "ID is required in parameter");
  const row =
    kind === "employee"
      ? await prismaClient.employee.findFirst({ where: { id, deleted_at: null }, select: { person_id: true } })
      : await prismaClient.intern.findFirst({ where: { id, deleted_at: null }, select: { person_id: true } });
  if (!row) throw new ResponseError(404, `${kind === "employee" ? "Employee" : "Intern"} not found`);
  return row.person_id;
}

export class GoogleAccountController {
  static status(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      const personId = await personIdOf(kind, c.req.param("id"));
      // Looking again at Google on demand is for Super Admins.
      const refresh = c.req.query("refresh") === "true" && c.var.admin.role === AdminRole.SUPER_ADMIN;
      return c.json({ data: await GoogleWorkspaceService.statusOf(personId, { refresh }) });
    };
  }

  static provision(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertSuperAdmin(c);
      const personId = await personIdOf(kind, c.req.param("id"));
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
      assertSuperAdmin(c);
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
}
