import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateEmployeeRequest,
  UpdateEmployeeRequest,
} from "../../model/employee-model";
import { EmployeeService } from "../../service/employee-service";
import { ResponseError } from "../../error/response-error";

export class EmployeeController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;

      const request = (await c.req.json()) as CreateEmployeeRequest;

      const response = await EmployeeService.create(admin, request);

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    try {
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

      const response = await EmployeeService.update(admin, payload);

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const employeeId = c.req.param("id");

      if (!employeeId) {
        throw new ResponseError(400, "Employee ID is required in parameter");
      }

      const response = await EmployeeService.get(admin, employeeId);
      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }
}
