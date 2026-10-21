import type { Context } from "hono";
import { ChildrenAllowanceRuleService } from "../../service/children-allowance-rule-service";
import type { AllowanceRule } from "../../utils/employee-children-rules";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type { AdminVariables } from "../../type/hono-context";

export class ChildrenAllowanceController {
  static async get(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ChildrenAllowanceRuleService.get() });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const body = (await c.req.json().catch(() => ({}))) as AllowanceRule;
    const data = await ChildrenAllowanceRuleService.update(c.var.admin, body, getAuditRequestContext(c));
    return c.json({ data });
  }
}
