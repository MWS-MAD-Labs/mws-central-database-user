import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type { CreateWorkingDayRequest } from "../../model/working-day-model";
import { WorkingDayService } from "../../service/working-day-service";
import { ResponseError } from "../../error/response-error";

export class WorkingDayController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const request = (await c.req.json()) as CreateWorkingDayRequest;

      const response = await WorkingDayService.create(admin, request);

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async list(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const response = await WorkingDayService.list(admin);

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    try {
      const admin = c.var.admin;
      const id = c.req.param("id");

      if (!id) {
        throw new ResponseError(400, "Working day ID is required in parameter");
      }

      const response = await WorkingDayService.remove(admin, { id });

      return c.json({ data: response });
    } catch (error) {
      throw error;
    }
  }
}
