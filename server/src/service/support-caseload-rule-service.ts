import { AdminRole, AuditAction, AuditSource, type AdminUser, type Prisma } from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { SupportCaseloadValidation } from "../validation/support-caseload-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";

const RULE_ID = "default";

// What the limit is until a Super Admin sets it.
export const DEFAULT_MAX_SUPPORT_STUDENTS = 2;

export type SupportCaseloadRule = { max_students: number };

export class SupportCaseloadRuleService {
  // The saved limit, or the default one while nobody has set it. Takes a transaction to read inside it.
  static async get(client: Prisma.TransactionClient | typeof prismaClient = prismaClient): Promise<SupportCaseloadRule> {
    const row = await client.supportCaseloadRule.findUnique({ where: { id: RULE_ID } });
    return { max_students: row?.max_students ?? DEFAULT_MAX_SUPPORT_STUDENTS };
  }

  static async update(
    admin: AdminUser,
    request: SupportCaseloadRule,
    context: AuditRequestContext = {},
  ): Promise<SupportCaseloadRule> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(403, "Forbidden: Only Super Admin can change the Special Education caseload limit");
    }
    const next = Validation.validate(SupportCaseloadValidation.UPDATE, request);
    const previous = await this.get();

    await prismaClient.$transaction(async (tx) => {
      await tx.supportCaseloadRule.upsert({
        where: { id: RULE_ID },
        create: { id: RULE_ID, ...next },
        update: next,
      });
      await AuditService.record(
        {
          action: AuditAction.UPDATE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "SupportCaseloadRule",
          entity_id: RULE_ID,
          admin_id: admin.id,
          old_values: { ...previous },
          new_values: { ...next },
          ip_address: context.ip_address,
          user_agent: context.user_agent,
        },
        tx,
      );
    });

    return this.get();
  }
}
