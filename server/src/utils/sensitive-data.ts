import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import { AuditService } from "../service/audit-service";
import { prismaClient } from "../lib/prisma";

// Independent of can_write_employee_data/can_write_student_data - viewing and writing sensitive data are separate grants.
export function canViewSensitiveData(
  admin: Pick<AdminUser, "role" | "can_view_sensitive_data">,
): boolean {
  return (
    admin.role === AdminRole.SUPER_ADMIN || admin.can_view_sensitive_data
  );
}

// Throws and audit-logs the blocked attempt if the admin can't view sensitive data.
export async function assertCanViewSensitiveData(
  admin: AdminUser,
  context: AuditRequestContext = {},
): Promise<void> {
  if (canViewSensitiveData(admin)) return;

  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: { reason: "sensitive data access attempted without permission" },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });

  throw new ResponseError(
    403,
    "Forbidden: You don't have permission to access sensitive data",
  );
}

// Same student-unit-scope rule as student-service.ts's create()/update() -
// a DATABASE_ADMIN can only write a student's relation data (parents,
// consent, health, vaccine, pc-activity) when the student's current grade
// is in their own unit. SUPER_ADMIN stays unscoped. Delete/restore on these
// resources are already SUPER_ADMIN-only, so this only guards create/update.
export async function assertStudentInAdminUnit(
  admin: Pick<AdminUser, "id" | "role" | "unit_id">,
  studentId: string,
  context: AuditRequestContext = {},
): Promise<void> {
  if (admin.role !== AdminRole.DATABASE_ADMIN) return;

  const student = await prismaClient.student.findUnique({
    where: { id: studentId },
    select: { current_grade: { select: { unit_id: true } } },
  });

  if (student && student.current_grade.unit_id === admin.unit_id) return;

  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: "blocked student relation write - student outside unit scope",
      student_id: studentId,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });

  throw new ResponseError(
    403,
    "Forbidden: This student is outside your unit scope",
  );
}

// Same unit-scope rule as employee-service.ts's update() - a DATABASE_ADMIN
// can only write an employee's photo when the employee's own unit_id
// matches their own. SUPER_ADMIN stays unscoped.
export async function assertEmployeeInAdminUnit(
  admin: Pick<AdminUser, "id" | "role" | "unit_id">,
  employeeId: string,
  context: AuditRequestContext = {},
): Promise<void> {
  if (admin.role !== AdminRole.DATABASE_ADMIN) return;

  const employee = await prismaClient.employee.findUnique({
    where: { id: employeeId },
    select: { unit_id: true },
  });

  if (employee && employee.unit_id === admin.unit_id) return;

  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: "blocked employee photo write - employee outside unit scope",
      employee_id: employeeId,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });

  throw new ResponseError(
    403,
    "Forbidden: This employee is outside your unit scope",
  );
}
