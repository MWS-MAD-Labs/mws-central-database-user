import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateConsentRequest,
  UpdateConsentRequest,
} from "../../model/consent-model";
import { ConsentService } from "../../service/consent-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class ConsentController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const body = (await c.req.json()) as CreateConsentRequest;

    const response = await ConsentService.create(
      admin,
      { ...body, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const consentId = c.req.param("consentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!consentId) {
      throw new ResponseError(
        400,
        "Consent record ID is required in parameter",
      );
    }

    const body = (await c.req.json()) as UpdateConsentRequest;

    const response = await ConsentService.update(
      admin,
      { ...body, id: consentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const consentId = c.req.param("consentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!consentId) {
      throw new ResponseError(
        400,
        "Consent record ID is required in parameter",
      );
    }

    const response = await ConsentService.remove(
      admin,
      { id: consentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const consentId = c.req.param("consentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!consentId) {
      throw new ResponseError(
        400,
        "Consent record ID is required in parameter",
      );
    }

    const response = await ConsentService.restore(
      admin,
      { id: consentId, student_id: studentId },
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

    const response = await ConsentService.getList(admin, {
      student_id: studentId,
      is_deleted: isDeletedQuery ? isDeletedQuery === "true" : undefined,
    });

    return c.json({ data: response });
  }
}
