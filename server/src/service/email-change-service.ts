import { AdminRole, AuditAction, AuditSource, type AdminUser } from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { isProtectedSuperAdminEmail } from "../utils/protected-admin";
import { EmailChangeValidation } from "../validation/email-change-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";
import { EmployeeService } from "./employee-service";
import { InternService } from "./intern-service";
import { StudentService } from "./student-service";

export type EmailChangeKind = "employee" | "intern" | "student";

const ENTITY = {
  employee: { entity: "Employee", action: AuditAction.UPDATE_EMPLOYEE },
  intern: { entity: "Intern", action: AuditAction.UPDATE_INTERN },
  student: { entity: "Student", action: AuditAction.UPDATE_STUDENT },
} as const;

// Changing the email of someone who exists renames their Google account and the address they sign in with, so it is its
// own action: only a Super Admin, with a reason, and never through a plain edit.
export class EmailChangeService {
  static async change(
    kind: EmailChangeKind,
    admin: AdminUser,
    id: string,
    request: { email?: string; reason?: string },
    context: AuditRequestContext = {},
  ): Promise<{ id: string; email: string }> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(403, "Forbidden: only a Super Admin can change an email");
    }
    const input = Validation.validate(EmailChangeValidation.CHANGE, request) as { email: string; reason: string };

    const row =
      kind === "employee"
        ? await prismaClient.employee.findFirst({ where: { id, deleted_at: null }, select: { id: true, person: { select: { email: true } } } })
        : kind === "intern"
          ? await prismaClient.intern.findFirst({ where: { id, deleted_at: null }, select: { id: true, person: { select: { email: true } } } })
          : await prismaClient.student.findFirst({ where: { id, deleted_at: null }, select: { id: true, person: { select: { email: true } } } });
    if (!row) throw new ResponseError(404, `${ENTITY[kind].entity} not found`);

    const oldEmail = row.person.email;
    if (input.email === oldEmail) throw new ResponseError(400, "That is already the email");
    if (isProtectedSuperAdminEmail(oldEmail) || isProtectedSuperAdminEmail(input.email)) {
      throw new ResponseError(400, "A protected admin address cannot be changed here");
    }
    // An admin signs in with their own email, so changing the person's alone would leave the admin on the old one.
    if (await prismaClient.adminUser.findFirst({ where: { email: oldEmail }, select: { id: true } })) {
      throw new ResponseError(400, "This person is also an admin. Change the admin's email first");
    }

    if (kind === "employee") {
      await EmployeeService.update(admin, { id, email: input.email }, context, new Date(), false, true);
    } else if (kind === "intern") {
      await InternService.update(admin, { id, email: input.email }, context, true);
    } else {
      await StudentService.update(admin, { id, email: input.email }, context, new Date(), false, true);
    }

    // The update entry holds the old and the new email; this one holds why.
    await AuditService.record({
      action: ENTITY[kind].action,
      source: AuditSource.UI,
      entity_type: ENTITY[kind].entity,
      entity_id: id,
      admin_id: admin.id,
      new_values: { field: "email", reason: input.reason },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return { id, email: input.email };
  }
}
