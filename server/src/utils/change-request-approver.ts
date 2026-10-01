import {
  AdminRole,
  EmployeeStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { logger } from "../lib/logger";

// Approvers are picked by a protected Super Admin in the UI and stored on
// AdminUser.can_approve_identifier_changes. The env list below only seeds the
// first approvers when nobody has the flag yet.
function bootstrapApproverEmails(): string[] {
  return (process.env.IDENTIFIER_CHANGE_APPROVER_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export const HEAD_OF_CARE_POSITION = "Head of CARE";

type ApproverFlags = Pick<AdminUser, "role" | "can_approve_identifier_changes">;

// Role floor: the CARE team that handles this data is already
// DATABASE_ADMIN at minimum, so the flag alone is not enough.
export function isChangeRequestApprover(admin: ApproverFlags): boolean {
  return (
    (admin.role === AdminRole.SUPER_ADMIN ||
      admin.role === AdminRole.DATABASE_ADMIN) &&
    admin.can_approve_identifier_changes
  );
}

// Employee data additionally needs the approver to be an active Head of CARE.
// Student requests only need the flag for now.
export async function canApproveEntity(
  admin: ApproverFlags & Pick<AdminUser, "person_id">,
  entityType: string,
): Promise<boolean> {
  if (!isChangeRequestApprover(admin)) return false;
  if (entityType !== "Employee") return true;
  if (!admin.person_id) return false;

  const employee = await prismaClient.employee.findFirst({
    where: {
      person_id: admin.person_id,
      deleted_at: null,
      status: EmployeeStatus.ACTIVE,
      job_position: { name: { equals: HEAD_OF_CARE_POSITION, mode: "insensitive" } },
    },
    select: { id: true },
  });
  return employee !== null;
}

// Boot check. When nobody holds the approver flag yet, the env list seeds
// it so a fresh deploy is not stuck without approvers.
export async function validateChangeRequestApproverConfig(): Promise<void> {
  const existing = await prismaClient.adminUser.count({
    where: {
      can_approve_identifier_changes: true,
      is_active: true,
      role: { in: [AdminRole.SUPER_ADMIN, AdminRole.DATABASE_ADMIN] },
    },
  });
  if (existing > 0) return;

  const emails = bootstrapApproverEmails();
  if (emails.length > 0) {
    const seeded = await prismaClient.adminUser.updateMany({
      where: {
        email: { in: emails, mode: "insensitive" },
        is_active: true,
        role: { in: [AdminRole.SUPER_ADMIN, AdminRole.DATABASE_ADMIN] },
      },
      data: { can_approve_identifier_changes: true },
    });
    if (seeded.count > 0) {
      logger.info(
        `Seeded ${seeded.count} identifier change approver(s) from IDENTIFIER_CHANGE_APPROVER_EMAILS.`,
      );
      return;
    }
  }

  logger.warn(
    "No identifier change approvers are set. A protected Super Admin can pick them on the Access page.",
  );
}
