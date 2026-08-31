import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import { AuditService } from "../service/audit-service";

// Comma-separated Super Admin emails that can never be demoted, deactivated,
// or have their permission flags changed by anyone - not another Super
// Admin, not another protected admin, not even themselves. Read from env
// (not a DB column) on purpose: flipping who's protected always requires a
// deploy, never just an API call - that's the whole point of the guarantee.
function protectedSuperAdminEmails(): string[] {
  return (process.env.PROTECTED_SUPER_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isProtectedSuperAdminEmail(email: string): boolean {
  return protectedSuperAdminEmails().includes(email.trim().toLowerCase());
}

// Blocks any role / active-status / permission-flag change targeting a
// protected admin's record. Audit-logged the same way as every other
// blocked admin-management attempt in AdminUserService.
export async function assertNotProtectedAdmin(
  admin: AdminUser,
  targetAdmin: Pick<AdminUser, "id" | "email">,
  action: string,
  context: AuditRequestContext = {},
): Promise<void> {
  if (!isProtectedSuperAdminEmail(targetAdmin.email)) return;

  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: `blocked ${action} on protected admin`,
      target_admin_id: targetAdmin.id,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });

  throw new ResponseError(
    403,
    "This Super Admin account is protected and cannot be modified",
  );
}

// Never let the org end up with zero active Super Admins - the one path
// left to fix a stuck state (another Super Admin) would then be gone too.
// Independent of assertNotProtectedAdmin - even a non-protected Super Admin
// can't be demoted/deactivated if they're the last one standing.
export async function assertNotLastActiveSuperAdmin(
  targetAdmin: Pick<AdminUser, "role" | "is_active">,
): Promise<void> {
  if (targetAdmin.role !== AdminRole.SUPER_ADMIN || !targetAdmin.is_active) {
    return;
  }

  const activeSuperAdminCount = await prismaClient.adminUser.count({
    where: { role: AdminRole.SUPER_ADMIN, is_active: true },
  });

  if (activeSuperAdminCount <= 1) {
    throw new ResponseError(
      400,
      "Cannot remove the last active Super Admin - promote another admin to Super Admin first",
    );
  }
}
