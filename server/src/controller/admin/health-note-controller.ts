import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateHealthNoteRequest,
  UpdateHealthNoteRequest,
} from "../../model/health-note-model";
import { HealthNoteService } from "../../service/health-note-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class HealthNoteController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const body = (await c.req.json()) as CreateHealthNoteRequest;

    const response = await HealthNoteService.create(
      admin,
      { ...body, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const noteId = c.req.param("noteId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!noteId) {
      throw new ResponseError(400, "Health note ID is required in parameter");
    }

    const body = (await c.req.json()) as UpdateHealthNoteRequest;

    const response = await HealthNoteService.update(
      admin,
      { ...body, id: noteId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const noteId = c.req.param("noteId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!noteId) {
      throw new ResponseError(400, "Health note ID is required in parameter");
    }

    const response = await HealthNoteService.remove(
      admin,
      { id: noteId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const noteId = c.req.param("noteId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!noteId) {
      throw new ResponseError(400, "Health note ID is required in parameter");
    }

    const response = await HealthNoteService.restore(
      admin,
      { id: noteId, student_id: studentId },
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

    const response = await HealthNoteService.getList(
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
