import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateHealthRecordRequest,
  UpdateHealthRecordRequest,
} from "../../model/health-record-model";
import { HealthRecordService } from "../../service/health-record-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class HealthRecordController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const body = (await c.req.json()) as CreateHealthRecordRequest;

    const response = await HealthRecordService.create(
      admin,
      { ...body, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const body = (await c.req.json()) as UpdateHealthRecordRequest;

    const response = await HealthRecordService.update(
      admin,
      { ...body, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await HealthRecordService.remove(
      admin,
      { student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await HealthRecordService.restore(
      admin,
      { student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await HealthRecordService.get(
      admin,
      { student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
