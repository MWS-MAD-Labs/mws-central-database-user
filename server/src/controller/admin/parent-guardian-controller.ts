import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateParentGuardianRequest,
  UpdateParentGuardianRequest,
} from "../../model/parent-guardian-model";
import { ParentGuardianService } from "../../service/parent-guardian-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class ParentGuardianController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const body = (await c.req.json()) as CreateParentGuardianRequest;

    const response = await ParentGuardianService.create(
      admin,
      { ...body, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const parentId = c.req.param("parentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!parentId) {
      throw new ResponseError(
        400,
        "Parent/guardian ID is required in parameter",
      );
    }

    const body = (await c.req.json()) as UpdateParentGuardianRequest;

    const response = await ParentGuardianService.update(
      admin,
      { ...body, id: parentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const parentId = c.req.param("parentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!parentId) {
      throw new ResponseError(
        400,
        "Parent/guardian ID is required in parameter",
      );
    }

    const response = await ParentGuardianService.remove(
      admin,
      { id: parentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const parentId = c.req.param("parentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!parentId) {
      throw new ResponseError(
        400,
        "Parent/guardian ID is required in parameter",
      );
    }

    const response = await ParentGuardianService.restore(
      admin,
      { id: parentId, student_id: studentId },
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

    const response = await ParentGuardianService.getList(admin, {
      student_id: studentId,
      is_deleted: isDeletedQuery ? isDeletedQuery === "true" : undefined,
    });

    return c.json({ data: response });
  }
}
