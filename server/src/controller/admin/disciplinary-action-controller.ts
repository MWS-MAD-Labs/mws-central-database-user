import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { DisciplinaryActionService } from "../../service/disciplinary-action-service";
import { DisciplinaryChangeRequestService } from "../../service/disciplinary-change-request-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type { DisciplinaryActionType } from "../../generated/prisma/enums";

export class DisciplinaryActionController {
  static async list(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    const query = c.req.query();
    const response = await DisciplinaryActionService.list(admin, {
      employee_id: employeeId,
      page: query.page ? Number(query.page) : 1,
      size: query.size ? Number(query.size) : 10,
    }, getAuditRequestContext(c));

    return c.json(response);
  }

  static async recordAccess(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    await DisciplinaryActionService.recordAccess(
      admin,
      employeeId,
      getAuditRequestContext(c),
    );

    return c.json({ data: true });
  }

  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    const body = (await c.req.json()) as {
      type: DisciplinaryActionType;
      reason: string;
      notes?: string;
      issued_date?: string;
      validity_days?: number;
    };

    const response = await DisciplinaryActionService.create(
      admin,
      { employee_id: employeeId, ...body },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const actionId = c.req.param("actionId");

    if (!employeeId || !actionId) {
      throw new ResponseError(
        400,
        "Employee ID and action ID are required in parameter",
      );
    }

    const body = (await c.req.json()) as {
      reason?: string;
      notes?: string;
    };

    const response = await DisciplinaryActionService.update(
      admin,
      { id: actionId, employee_id: employeeId, ...body },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async requestEdit(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const actionId = c.req.param("actionId");
    if (!employeeId || !actionId) {
      throw new ResponseError(400, "Employee ID and action ID are required in parameter");
    }
    const body = (await c.req.json()) as {
      reason?: string;
      notes?: string;
      change_reason: string;
    };
    const response = await DisciplinaryChangeRequestService.requestEdit(
      admin,
      { id: actionId, employee_id: employeeId, ...body },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async resolve(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const actionId = c.req.param("actionId");

    if (!employeeId || !actionId) {
      throw new ResponseError(
        400,
        "Employee ID and action ID are required in parameter",
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      resolved_reason?: string;
    };

    const response = await DisciplinaryActionService.resolve(
      admin,
      { id: actionId, employee_id: employeeId, ...body },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async revoke(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const actionId = c.req.param("actionId");

    if (!employeeId || !actionId) {
      throw new ResponseError(
        400,
        "Employee ID and action ID are required in parameter",
      );
    }

    const response = await DisciplinaryActionService.revoke(
      admin,
      { id: actionId, employee_id: employeeId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
