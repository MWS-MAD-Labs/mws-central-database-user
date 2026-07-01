import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context"; // Tambahkan import ini
import type { CreateEmployeeRequest } from "../../model/employee-model";
import { EmployeeService } from "../../service/employee-service";

export class EmployeeController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    try {
      const request = (await c.req.json()) as CreateEmployeeRequest;

      const admin = c.var.admin;

      const response = await EmployeeService.create(admin, request);

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }
}
