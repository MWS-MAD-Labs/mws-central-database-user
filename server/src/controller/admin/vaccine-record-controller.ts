import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateVaccineRecordRequest,
  UpdateVaccineRecordRequest,
} from "../../model/vaccine-record-model";
import { VaccineRecordService } from "../../service/vaccine-record-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class VaccineRecordController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const body = (await c.req.json()) as CreateVaccineRecordRequest;

    const response = await VaccineRecordService.create(
      admin,
      { ...body, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const vaccineId = c.req.param("vaccineId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!vaccineId) {
      throw new ResponseError(
        400,
        "Vaccine record ID is required in parameter",
      );
    }

    const body = (await c.req.json()) as UpdateVaccineRecordRequest;

    const response = await VaccineRecordService.update(
      admin,
      { ...body, id: vaccineId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const vaccineId = c.req.param("vaccineId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!vaccineId) {
      throw new ResponseError(
        400,
        "Vaccine record ID is required in parameter",
      );
    }

    const response = await VaccineRecordService.remove(
      admin,
      { id: vaccineId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const vaccineId = c.req.param("vaccineId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!vaccineId) {
      throw new ResponseError(
        400,
        "Vaccine record ID is required in parameter",
      );
    }

    const response = await VaccineRecordService.restore(
      admin,
      { id: vaccineId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async getList(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const isDeletedQuery = c.req.query("is_deleted");

    const response = await VaccineRecordService.getList(
      admin,
      {
        student_id: studentId,
        is_deleted: isDeletedQuery ? isDeletedQuery === "true" : undefined,
      },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
