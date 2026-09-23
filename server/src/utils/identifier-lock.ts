import {
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import { AuditService } from "../service/audit-service";

export const IDENTIFIER_EDIT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export function isPastIdentifierGracePeriod(anchor: Date, now: Date = new Date()): boolean {
  return now.getTime() - anchor.getTime() > IDENTIFIER_EDIT_GRACE_PERIOD_MS;
}

export async function assertIdentifierFieldsEditable(
  admin: AdminUser,
  createdAt: Date,
  changed: boolean,
  fieldLabel: string,
  context: AuditRequestContext = {},
  now: Date = new Date(),
  // Set only by the approved-identifier-change-request flow
  // (identifier-change-request-service.ts) to apply the one approved
  // field past its grace period. Never a general bypass.
  bypass = false,
): Promise<void> {
  if (!changed) return;
  if (bypass) return;

  const withinGracePeriod =
    now.getTime() - createdAt.getTime() <= IDENTIFIER_EDIT_GRACE_PERIOD_MS;
  if (withinGracePeriod) return;

  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: {
      reason: `blocked ${fieldLabel} edit - past the 1-day grace period`,
    },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });

  throw new ResponseError(
    400,
    `${fieldLabel} can only be changed within 1 day of the record's creation. Soft-delete and recreate the record instead.`,
  );
}
