import type { Context } from "hono";
import { z } from "zod";
import { AdminRole } from "../../generated/prisma/client";
import { ResponseError } from "../../error/response-error";
import { prismaClient } from "../../lib/prisma";
import { GoogleWorkspaceService } from "../../service/google-workspace-service";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type { AdminVariables } from "../../type/hono-context";
import { assertCanViewStudentData, isUnitWritable, resolveStudentUnitScope } from "../../utils/admin-permissions";
import { maskEmail } from "../../service/google-workspace-service";
import { assertCanWriteNow } from "../../utils/office-hours";
import { isProtectedSuperAdminEmail } from "../../utils/protected-admin";
import { recoveryEmail } from "../../validation/validation";
import { Validation } from "../../validation/validation";

type Kind = "employee" | "intern" | "student";

const PROVISION = z.object({ recovery_email: recoveryEmail().optional() });
const CHANGE_RECOVERY = z.object({ recovery_email: recoveryEmail() });
const RESET_WAITING = z.object({ language: z.enum(["id", "en"]).default("id") });
const SEND_SIGN_IN = z.object({
  to: recoveryEmail().optional(),
  language: z.enum(["id", "en"]),
  password: z.string().min(8).max(64),
});
// A student's details go to a parent or guardian Central already holds, chosen from the list, never typed.
const STUDENT_PROVISION = z.object({ parent_id: z.string().min(1).optional() });
const STUDENT_SEND_SIGN_IN = z.object({
  parent_id: z.string().min(1),
  language: z.enum(["id", "en"]),
  password: z.string().min(8).max(64),
});

// Three levels. Making or linking an account is for a Super Admin or a Database Admin who may write employees in the
// person's unit. Suspending, restoring and looking at Google again are for Super Admins. Resetting the password and
// changing the recovery email can take an account over, so they are for the protected Super Admins only.
type Admin = Context<{ Variables: AdminVariables }>["var"]["admin"];
type Target = { personId: string; unitId: string; kind: Kind; studentId?: string };

const isSuperAdmin = (admin: Admin) => admin.role === AdminRole.SUPER_ADMIN;
const isProtected = (admin: Admin) => isSuperAdmin(admin) && isProtectedSuperAdminEmail(admin.email);
const canCreate = (admin: Admin, target: Pick<Target, "unitId" | "kind">) =>
  isSuperAdmin(admin) ||
  (admin.role === AdminRole.DATABASE_ADMIN &&
    (target.kind === "student"
      ? admin.can_write_student_data && isUnitWritable(admin, target.unitId, "student")
      : admin.can_write_employee_data && isUnitWritable(admin, target.unitId, "employee")));

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
  if (!canCreate(admin, target)) {
    throw new ResponseError(403, "Forbidden: you cannot create Google accounts for this person");
  }
  if (admin.role === AdminRole.DATABASE_ADMIN) await assertCanWriteNow(admin, getAuditRequestContext(c));
}

async function targetOf(kind: Kind, id: string | undefined, admin?: Admin): Promise<Target> {
  if (!id) throw new ResponseError(400, "ID is required in parameter");
  if (kind === "student") {
    const row = await prismaClient.student.findFirst({
      where: { id, deleted_at: null },
      select: { person_id: true, current_grade: { select: { unit_id: true } } },
    });
    if (!row) throw new ResponseError(404, "Student not found");
    const unitId = row.current_grade.unit_id;
    // Who may look at students in this unit may look at their Google account; the unit scope of the student domain.
    if (admin) {
      assertCanViewStudentData(admin);
      const scope = resolveStudentUnitScope(admin);
      if (scope !== undefined && !scope.includes(unitId)) throw new ResponseError(404, "Student not found");
    }
    return { personId: row.person_id, unitId, kind, studentId: id };
  }
  const row =
    kind === "employee"
      ? await prismaClient.employee.findFirst({ where: { id, deleted_at: null }, select: { person_id: true, unit_id: true } })
      : await prismaClient.intern.findFirst({ where: { id, deleted_at: null }, select: { person_id: true, unit_id: true } });
  if (!row) throw new ResponseError(404, `${kind === "employee" ? "Employee" : "Intern"} not found`);
  return { personId: row.person_id, unitId: row.unit_id, kind };
}

async function personIdOf(kind: Kind, id: string | undefined, admin?: Admin): Promise<string> {
  return (await targetOf(kind, id, admin)).personId;
}

// The parents and guardians of a student who have an email, for choosing who the details go to. The email is shown
// hidden; the phone only to an admin who may see sensitive student data, like the parents' own panel.
async function guardiansOf(studentId: string, admin: Admin) {
  const rows = await prismaClient.parentGuardian.findMany({
    where: { student_id: studentId, deleted_at: null },
    orderBy: [{ is_primary: "desc" }, { created_at: "asc" }],
    select: { id: true, type: true, full_name: true, email: true, phone: true, is_primary: true },
  });
  const mayWhatsApp = isSuperAdmin(admin) || admin.can_view_sensitive_data;
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    full_name: row.full_name,
    is_primary: row.is_primary,
    email_hint: row.email ? maskEmail(row.email) : null,
    phone: mayWhatsApp ? row.phone : null,
  }));
}

// The parent or guardian a student's account is made for: the one asked for, or the primary one, who must have an email.
async function guardianOf(studentId: string, parentId?: string) {
  const guardian = await prismaClient.parentGuardian.findFirst({
    where: {
      student_id: studentId,
      deleted_at: null,
      email: { not: null },
      ...(parentId ? { id: parentId } : {}),
    },
    orderBy: [{ is_primary: "desc" }, { created_at: "asc" }],
    select: { id: true, type: true, full_name: true, email: true, phone: true, is_primary: true },
  });
  if (!guardian || !guardian.email) {
    throw new ResponseError(
      400,
      parentId
        ? "That parent or guardian is not on this student or has no email"
        : "Add a parent or guardian with an email first",
    );
  }
  return { ...guardian, email: guardian.email };
}

export class GoogleAccountController {
  static status(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      const target = await targetOf(kind, c.req.param("id"), c.var.admin);
      const admin = c.var.admin;
      // Looking again at Google on demand is for Super Admins.
      const refresh = c.req.query("refresh") === "true" && isSuperAdmin(admin);
      const status = await GoogleWorkspaceService.statusOf(target.personId, { refresh });
      // What this admin may do, so the page only shows those buttons.
      const guardians = target.studentId ? await guardiansOf(target.studentId, admin) : undefined;
      // Linking an account Google already has: a student's is for a Super Admin and a legacy student only.
      let linkExisting = canCreate(admin, target);
      if (target.studentId) {
        const student = await prismaClient.student.findFirst({ where: { id: target.studentId }, select: { nis: true, legacy_nis: true } });
        const legacy = status.status === "PENDING_CLAIM" || Boolean(student && (student.legacy_nis || !student.nis));
        linkExisting = isSuperAdmin(admin) && legacy;
      }
      return c.json({
        data: {
          ...status,
          can: { create: canCreate(admin, target), link_existing: linkExisting, manage: isSuperAdmin(admin), takeover: isProtected(admin) },
          ...(guardians ? { guardians } : {}),
        },
      });
    };
  }

  static provision(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      const target = await targetOf(kind, c.req.param("id"), c.var.admin);
      await assertCanCreate(c, target);
      const personId = target.personId;
      const body = await c.req.json().catch(() => ({}));
      // A student whose email Google already has is linked, by a Super Admin and by name, instead of made.
      if (target.studentId) {
        const linked = await GoogleWorkspaceService.linkStudent(personId, c.var.admin, getAuditRequestContext(c));
        if (linked) return c.json({ data: linked });
      }
      // A student's recovery email is a parent's or guardian's, so the first password and "Forgot password" reach them.
      const recovery = target.studentId
        ? (await guardianOf(target.studentId, Validation.validate(STUDENT_PROVISION, body).parent_id)).email
        : Validation.validate(PROVISION, body).recovery_email;
      const result = await GoogleWorkspaceService.provision(personId, {
        recoveryEmail: recovery,
        admin: c.var.admin,
        context: getAuditRequestContext(c),
      });
      // 409 when Google already had it and it was linked is not an error: the result says "linked".
      return c.json({ data: result });
    };
  }

  // Mails the first sign-in details to an address the admin gives. The server writes the mail itself.
  static sendSignIn(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      const target = await targetOf(kind, c.req.param("id"), c.var.admin);
      await assertCanCreate(c, target);
      const body = await c.req.json().catch(() => ({}));
      c.header("Cache-Control", "no-store");
      if (target.studentId) {
        const input = Validation.validate(STUDENT_SEND_SIGN_IN, body);
        const guardian = await guardianOf(target.studentId, input.parent_id);
        const result = await GoogleWorkspaceService.sendSignInEmail(
          target.personId,
          { to: guardian.email, language: input.language, password: input.password, parentName: guardian.full_name },
          c.var.admin,
          getAuditRequestContext(c),
        );
        return c.json({ data: result });
      }
      const input = Validation.validate(SEND_SIGN_IN, body);
      const result = await GoogleWorkspaceService.sendSignInEmail(target.personId, input, c.var.admin, getAuditRequestContext(c));
      return c.json({ data: result });
    };
  }

  static resetPassword(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertProtectedSuperAdmin(c, "reset a Google password");
      const target = await targetOf(kind, c.req.param("id"), c.var.admin);
      const personId = target.personId;
      const context = getAuditRequestContext(c);
      const body = await c.req.json().catch(() => ({}));
      // A student's new password goes to the parent or guardian chosen from the student's own, the default being the
      // primary one with an email. Anyone else's goes to the recovery email Google holds.
      let guardian: Awaited<ReturnType<typeof guardianOf>> | null = null;
      if (target.studentId) {
        guardian = await guardianOf(target.studentId, Validation.validate(STUDENT_PROVISION, body).parent_id).catch(() => null);
      }
      const { password } = await GoogleWorkspaceService.resetPassword(personId, c.var.admin, context);
      // Never cached: it is a password.
      c.header("Cache-Control", "no-store");
      // Mailed at once, so the admin does not see it. Shown only when it could not be sent: it has changed already.
      const sent = await GoogleWorkspaceService.deliverPassword(
        personId,
        {
          password,
          reset: true,
          ...(guardian ? { to: guardian.email, parentName: guardian.full_name } : {}),
          // A student with nobody to send to is not sent to Google's recovery email either.
          ...(target.studentId && !guardian ? { to: "" } : {}),
        },
        c.var.admin,
        context,
      );
      return c.json({ data: sent ? { sent_to: sent.delivered_to } : { password } });
    };
  }

  // The account waits for its owner: the password goes to the recovery email Google holds and is never returned here.
  static resetWaiting(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertProtectedSuperAdmin(c, "reset a Google password");
      const personId = await personIdOf(kind, c.req.param("id"), c.var.admin);
      const body = await c.req.json().catch(() => ({}));
      const { language } = Validation.validate(RESET_WAITING, body);
      const result = await GoogleWorkspaceService.resetWaiting(personId, c.var.admin, { language }, getAuditRequestContext(c));
      c.header("Cache-Control", "no-store");
      return c.json({ data: result });
    };
  }

  static restore(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertSuperAdmin(c);
      const personId = await personIdOf(kind, c.req.param("id"), c.var.admin);
      const result = await GoogleWorkspaceService.restore(personId, c.var.admin, getAuditRequestContext(c));
      return c.json({ data: result });
    };
  }

  static suspend(kind: Kind, suspended: boolean) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertSuperAdmin(c);
      const personId = await personIdOf(kind, c.req.param("id"), c.var.admin);
      const result = await GoogleWorkspaceService.setSuspended(personId, suspended, c.var.admin, getAuditRequestContext(c));
      return c.json({ data: result });
    };
  }

  static recoveryEmail(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      assertSuperAdmin(c);
      const personId = await personIdOf(kind, c.req.param("id"), c.var.admin);
      c.header("Cache-Control", "no-store");
      return c.json({ data: await GoogleWorkspaceService.recoveryEmailOf(personId) });
    };
  }

  // A recovery email that is missing may be added by whoever may make the account; replacing one that is there can take
  // the account over, so that stays with the protected Super Admins.
  static changeRecoveryEmail(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      const target = await targetOf(kind, c.req.param("id"), c.var.admin);
      const protectedAdmin = isProtected(c.var.admin);
      if (!protectedAdmin) await assertCanCreate(c, target);
      const body = await c.req.json().catch(() => ({}));
      const { recovery_email } = Validation.validate(CHANGE_RECOVERY, body);
      await GoogleWorkspaceService.changeRecoveryEmail(
        target.personId,
        recovery_email,
        c.var.admin,
        getAuditRequestContext(c),
        { onlyIfEmpty: !protectedAdmin },
      );
      return c.json({ data: true });
    };
  }

  // Where the sign-in details would go, hidden ("b***@gmail.com"), or null when the account has no recovery email.
  static recoveryHint(kind: Kind) {
    return async (c: Context<{ Variables: AdminVariables }>) => {
      const target = await targetOf(kind, c.req.param("id"), c.var.admin);
      await assertCanCreate(c, target);
      const { recovery_email } = await GoogleWorkspaceService.recoveryEmailOf(target.personId);
      c.header("Cache-Control", "no-store");
      return c.json({ data: { hint: recovery_email } });
    };
  }
}
