import type { Context } from "hono";
import { AdminRole } from "../../generated/prisma/client";
import { ResponseError } from "../../error/response-error";
import { GoogleReconcileService } from "../../service/google-reconcile-service";
import { GoogleWorkspaceService } from "../../service/google-workspace-service";
import { isProtectedSuperAdminEmail } from "../../utils/protected-admin";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type { AdminVariables } from "../../type/hono-context";

// Staff (employees and interns) unless the page asks for students.
const kindOf = (c: Context<{ Variables: AdminVariables }>): "staff" | "students" =>
  c.req.query("kind") === "students" ? "students" : "staff";

export class GoogleController {
  // Whether an email can be given to a new employee or intern. For the admins who can create them.
  static async emailAvailability(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    if (admin.role === AdminRole.VIEWER || (admin.role === AdminRole.DATABASE_ADMIN && !admin.can_write_employee_data)) {
      throw new ResponseError(403, "Forbidden: You don't have permission to create employees");
    }
    const email = c.req.query("email");
    if (!email) throw new ResponseError(400, "Email is required");
    return c.json({ data: await GoogleWorkspaceService.checkEmailAvailable(email) });
  }

  // What a link would do, without doing it. Super Admins only.
  static async linkPreview(c: Context<{ Variables: AdminVariables }>) {
    if (c.var.admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(403, "Forbidden: only a Super Admin can link Google accounts");
    }
    return c.json({ data: await GoogleWorkspaceService.linkExisting({ link: false, kind: kindOf(c) }) });
  }

  // Where Central and Google disagree. Reads only. Super Admins only.
  static async reconcile(c: Context<{ Variables: AdminVariables }>) {
    if (c.var.admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(403, "Forbidden: only a Super Admin can compare Central with Google");
    }
    return c.json({ data: await GoogleReconcileService.run() });
  }

  static async linkExisting(c: Context<{ Variables: AdminVariables }>) {
    if (c.var.admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(403, "Forbidden: only a Super Admin can link Google accounts");
    }
    const data = await GoogleWorkspaceService.linkExisting({
      link: true,
      kind: kindOf(c),
      admin: c.var.admin,
      context: getAuditRequestContext(c),
    });
    return c.json({ data });
  }

  // Students the rule refused, linked by a protected Super Admin who looked at the two names. The same checks as the
  // bulk link stay, except the legacy rule and the name.
  static async linkStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    if (admin.role !== AdminRole.SUPER_ADMIN || !isProtectedSuperAdminEmail(admin.email)) {
      throw new ResponseError(403, "Forbidden: only a protected Super Admin can link students the rule refused");
    }
    const body = (await c.req.json().catch(() => ({}))) as { person_ids?: unknown };
    const ids = Array.isArray(body.person_ids) ? body.person_ids : null;
    if (!ids || ids.length === 0 || ids.length > 100 || ids.some((id) => typeof id !== "string" || !id)) {
      throw new ResponseError(400, "person_ids must be 1 to 100 student ids");
    }
    return c.json({ data: await GoogleWorkspaceService.linkStudentsAnyway(ids as string[], admin, getAuditRequestContext(c)) });
  }
}
