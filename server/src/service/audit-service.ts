import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import type { RecordAuditLogRequest } from "../model/audit-log-model";
import { AuditLogValidation } from "../validation/audit-log-validation";
import { Validation } from "../validation/validation";

type AuditLogWriter = PrismaClient | Prisma.TransactionClient;

export class AuditService {
  static async record(
    request: RecordAuditLogRequest,
    writer: AuditLogWriter = prismaClient,
  ): Promise<void> {
    const validated = Validation.validate(AuditLogValidation.RECORD, request);

    // A no-op "update" (admin saved a form without actually changing
    // anything) shouldn't leave a trail entry - every UPDATE_* caller builds
    // old_values/new_values from the same toXAuditSnapshot() function, so
    // this is a like-for-like comparison, not just coincidentally similar
    // shapes. Only fires when both sides are present - CREATE/DELETE/etc
    // only ever set one side, so this never touches those. Centralized here
    // instead of in each of the ~15 services that call update() with an
    // audit snapshot, so the fix (and any future one) doesn't need
    // reapplying per service.
    if (
      validated.old_values &&
      validated.new_values &&
      JSON.stringify(validated.old_values) ===
        JSON.stringify(validated.new_values)
    ) {
      return;
    }

    try {
      await writer.auditLog.create({
        data: {
          action: validated.action,
          source: validated.source,

          entity_type: validated.entity_type,
          entity_id: validated.entity_id,

          admin_id: validated.admin_id,
          api_client_id: validated.api_client_id,

          old_values: validated.old_values ?? Prisma.JsonNull,
          new_values: validated.new_values ?? Prisma.JsonNull,

          ip_address: validated.ip_address,
          user_agent: validated.user_agent,
        },
      });
    } catch (error) {
      logger.error("Failed to write audit log", {
        error,
        action: validated.action,
        entity_type: validated.entity_type,
        entity_id: validated.entity_id,
      });

      const isRunningInsideTransaction = writer !== prismaClient;
      if (isRunningInsideTransaction) {
        throw error;
      }
    }
  }
}
