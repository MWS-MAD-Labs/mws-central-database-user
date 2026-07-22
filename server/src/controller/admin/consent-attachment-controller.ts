import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { ConsentAttachmentService } from "../../service/consent-attachment-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class ConsentAttachmentController {
  static async upload(c: Context<{ Variables: AdminVariables }>) {
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

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw new ResponseError(400, "A file is required under the 'file' field");
    }

    const response = await ConsentAttachmentService.upload(
      admin,
      { student_id: studentId, consent_id: consentId },
      file,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const consentId = c.req.param("consentId");
    const attachmentId = c.req.param("attachmentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!consentId) {
      throw new ResponseError(
        400,
        "Consent record ID is required in parameter",
      );
    }
    if (!attachmentId) {
      throw new ResponseError(400, "Attachment ID is required in parameter");
    }

    const response = await ConsentAttachmentService.remove(
      admin,
      { id: attachmentId, consent_id: consentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const consentId = c.req.param("consentId");
    const attachmentId = c.req.param("attachmentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!consentId) {
      throw new ResponseError(
        400,
        "Consent record ID is required in parameter",
      );
    }
    if (!attachmentId) {
      throw new ResponseError(400, "Attachment ID is required in parameter");
    }

    const response = await ConsentAttachmentService.restore(
      admin,
      { id: attachmentId, consent_id: consentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async getList(c: Context<{ Variables: AdminVariables }>) {
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

    const isDeletedQuery = c.req.query("is_deleted");

    const response = await ConsentAttachmentService.getList(
      admin,
      {
        student_id: studentId,
        consent_id: consentId,
        is_deleted: isDeletedQuery ? isDeletedQuery === "true" : undefined,
      },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async download(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const consentId = c.req.param("consentId");
    const attachmentId = c.req.param("attachmentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!consentId) {
      throw new ResponseError(
        400,
        "Consent record ID is required in parameter",
      );
    }
    if (!attachmentId) {
      throw new ResponseError(400, "Attachment ID is required in parameter");
    }

    const { buffer, fileName, mimeType } =
      await ConsentAttachmentService.download(
        admin,
        { id: attachmentId, consent_id: consentId, student_id: studentId },
        getAuditRequestContext(c),
      );

    return c.body(new Uint8Array(buffer), 200, {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
  }
}
