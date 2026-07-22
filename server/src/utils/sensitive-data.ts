import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import { AuditService } from "../service/audit-service";

// Independent of can_write_data - viewing and writing sensitive data are separate grants.
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
