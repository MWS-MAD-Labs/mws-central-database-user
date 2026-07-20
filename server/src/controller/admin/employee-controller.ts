import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateEmployeeRequest,
  EmployeeSortField,
  SearchEmployeeRequest,
  UpdateEmployeeRequest,
} from "../../model/employee-model";
import { EmployeeService } from "../../service/employee-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type {
  EmployeeStatus,
  Gender,
  Religion,
} from "../../generated/prisma/enums";

export class EmployeeController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request = (await c.req.json()) as CreateEmployeeRequest;

    const response = await EmployeeService.create(
      admin,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    const request = (await c.req.json()) as UpdateEmployeeRequest;

    const payload: UpdateEmployeeRequest = {
      ...request,
      id: employeeId,
    };

    const response = await EmployeeService.update(
      admin,
      payload,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    const response = await EmployeeService.get(admin, { id: employeeId });
    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const rawPage = c.req.query("page");
    const rawSize = c.req.query("size");
    const page = rawPage !== undefined ? Number(rawPage) : 1;
    const size = rawSize !== undefined ? Number(rawSize) : 10;

    if (Number.isNaN(page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const request: SearchEmployeeRequest = {
      // Pagination
      page,
      size,

      // Global Keyword
      search: c.req.query("search"),

      // Filter
      status: c.req.query("status") as EmployeeStatus | undefined,
      unit_id: c.req.query("unit_id"),
      job_position_id: c.req.query("job_position_id"),
      job_level_id: c.req.query("job_level_id"),
      building: c.req.query("building"),
      gender: c.req.query("gender") as Gender | undefined,
      religion: c.req.query("religion") as Religion | undefined,
      join_date_start: c.req.query("join_date_start"),
      join_date_end: c.req.query("join_date_end"),

      is_deleted: c.req.query("is_deleted")
        ? c.req.query("is_deleted") === "true"
        : undefined,

      sort_by: c.req.query("sort_by") as EmployeeSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    const response = await EmployeeService.search(admin, request);

    return c.json(response);
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    const response = await EmployeeService.remove(
      admin,
      { id: employeeId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }

    const response = await EmployeeService.restore(
      admin,
      { id: employeeId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
