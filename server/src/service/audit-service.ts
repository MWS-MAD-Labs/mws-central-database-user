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
