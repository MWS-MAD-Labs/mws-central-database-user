import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { DisciplinaryActionAttachmentService } from "../../service/disciplinary-action-attachment-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class DisciplinaryActionAttachmentController {
  static async upload(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const actionId = c.req.param("actionId");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }
    if (!actionId) {
      throw new ResponseError(
        400,
        "Disciplinary action ID is required in parameter",
      );
    }

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw new ResponseError(400, "A file is required under the 'file' field");
    }

    const response = await DisciplinaryActionAttachmentService.upload(
      admin,
      { employee_id: employeeId, disciplinary_action_id: actionId },
      file,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const actionId = c.req.param("actionId");
    const attachmentId = c.req.param("attachmentId");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }
    if (!actionId) {
      throw new ResponseError(
        400,
        "Disciplinary action ID is required in parameter",
      );
    }
    if (!attachmentId) {
      throw new ResponseError(400, "Attachment ID is required in parameter");
    }

    const response = await DisciplinaryActionAttachmentService.remove(
      admin,
      { id: attachmentId, disciplinary_action_id: actionId, employee_id: employeeId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const actionId = c.req.param("actionId");
    const attachmentId = c.req.param("attachmentId");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }
    if (!actionId) {
      throw new ResponseError(
        400,
        "Disciplinary action ID is required in parameter",
      );
    }
    if (!attachmentId) {
      throw new ResponseError(400, "Attachment ID is required in parameter");
    }

    const response = await DisciplinaryActionAttachmentService.restore(
      admin,
      { id: attachmentId, disciplinary_action_id: actionId, employee_id: employeeId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async getList(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const actionId = c.req.param("actionId");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }
    if (!actionId) {
      throw new ResponseError(
        400,
        "Disciplinary action ID is required in parameter",
      );
    }

    const isDeletedQuery = c.req.query("is_deleted");

    const response = await DisciplinaryActionAttachmentService.getList(admin, {
      employee_id: employeeId,
      disciplinary_action_id: actionId,
      is_deleted: isDeletedQuery ? isDeletedQuery === "true" : undefined,
    });

    return c.json({ data: response });
  }

  static async download(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const employeeId = c.req.param("id");
    const actionId = c.req.param("actionId");
    const attachmentId = c.req.param("attachmentId");

    if (!employeeId) {
      throw new ResponseError(400, "Employee ID is required in parameter");
    }
    if (!actionId) {
      throw new ResponseError(
        400,
        "Disciplinary action ID is required in parameter",
      );
    }
    if (!attachmentId) {
      throw new ResponseError(400, "Attachment ID is required in parameter");
    }

    const { buffer, fileName, mimeType } =
      await DisciplinaryActionAttachmentService.download(
        admin,
        { id: attachmentId, disciplinary_action_id: actionId, employee_id: employeeId },
        getAuditRequestContext(c),
      );

    return c.body(new Uint8Array(buffer), 200, {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
  }
}
