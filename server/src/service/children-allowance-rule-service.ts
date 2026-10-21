import { AdminRole, AuditAction, AuditSource, type AdminUser } from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import { DEFAULT_ALLOWANCE_RULE, type AllowanceRule } from "../utils/employee-children-rules";
import { ChildrenAllowanceValidation } from "../validation/children-allowance-validation";
import { Validation } from "../validation/validation";
import { AuditService } from "./audit-service";

const RULE_ID = "default";

const toRule = (row: AllowanceRule | null): AllowanceRule =>
  row
    ? {
        max_children: row.max_children,
        age_limit: row.age_limit,
        count_biological: row.count_biological,
        count_adopted: row.count_adopted,
        count_step: row.count_step,
      }
    : { ...DEFAULT_ALLOWANCE_RULE };

export class ChildrenAllowanceRuleService {
  // The saved rule, or the default one while nobody has set it.
  static async get(): Promise<AllowanceRule> {
    return toRule(await prismaClient.childrenAllowanceRule.findUnique({ where: { id: RULE_ID } }));
  }

  static async update(
    admin: AdminUser,
    request: AllowanceRule,
    context: AuditRequestContext = {},
  ): Promise<AllowanceRule> {
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(403, "Forbidden: Only Super Admin can change the children allowance rule");
    }
    const next = Validation.validate(ChildrenAllowanceValidation.UPDATE, request);
    const previous = await this.get();

    await prismaClient.$transaction(async (tx) => {
      await tx.childrenAllowanceRule.upsert({
        where: { id: RULE_ID },
        create: { id: RULE_ID, ...next },
        update: next,
      });
      await AuditService.record(
        {
          action: AuditAction.UPDATE_MASTER_DATA,
          source: AuditSource.UI,
          entity_type: "ChildrenAllowanceRule",
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
