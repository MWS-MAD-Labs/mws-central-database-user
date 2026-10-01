import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  AssignClassTeacherRequest,
  BulkMoveClassTeacherAssignmentRequest,
  BulkEndClassTeacherAssignmentRequest,
  BulkRemoveClassTeacherAssignmentRequest,
  BulkReopenClassTeacherAssignmentRequest,
  BulkUpdateClassTeacherAssignmentStartDateRequest,
  ClassSortField,
  CreateClassRequest,
  EndClassTeacherAssignmentRequest,
  SearchClassRequest,
  UpdateClassRequest,
  UpdateClassTeacherAssignmentStartDateRequest,
} from "../../model/class-model";
import { ClassService } from "../../service/class-service";
import { ResponseError } from "../../error/response-error";
import type { ClassStatus, ClassTeacherRole } from "../../generated/prisma/client";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class ClassController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const request = (await c.req.json()) as CreateClassRequest;

    const response = await ClassService.create(
      admin,
      request,
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async update(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const request = (await c.req.json()) as UpdateClassRequest;

    const response = await ClassService.update(
      admin,
      {
        ...request,
        id,
      },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const response = await ClassService.remove(
      admin,
      { id },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const response = await ClassService.get(admin, { id });

    return c.json({ data: response });
  }

  static async getTeacherAssignments(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const response = await ClassService.getTeacherAssignments(admin, { id });

    return c.json({ data: response });
  }

  static async searchTeacherCandidates(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const id = c.req.param("id");
    if (!id) throw new ResponseError(400, "Class ID is required in parameter");
    const page = c.req.query("page") ? Number(c.req.query("page")) : 1;
    const size = c.req.query("size") ? Number(c.req.query("size")) : 10;
    if (Number.isNaN(page)) throw new ResponseError(400, "page must be a valid number");
    if (Number.isNaN(size)) throw new ResponseError(400, "size must be a valid number");
    const response = await ClassService.searchTeacherCandidates(c.var.admin, {
      class_id: id,
      page,
      size,
      search: c.req.query("search"),
      role: c.req.query("role") as ClassTeacherRole,
    });
    return c.json(response);
  }

  static async assignTeacher(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const classId = c.req.param("id");

    if (!classId) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const request = (await c.req.json()) as AssignClassTeacherRequest;

    const response = await ClassService.assignTeacher(
      admin,
      { ...request, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async endTeacherAssignment(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const classId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");

    if (!classId || !assignmentId) {
      throw new ResponseError(
        400,
        "Class ID and assignment ID are required in parameter",
      );
    }

    const request = (await c.req.json()) as EndClassTeacherAssignmentRequest;

    const response = await ClassService.endTeacherAssignment(
      admin,
      { ...request, id: assignmentId, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async updateTeacherAssignmentStartDate(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const classId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");
    if (!classId || !assignmentId) {
      throw new ResponseError(400, "Class ID and assignment ID are required in parameter");
    }
    const request = (await c.req.json()) as UpdateClassTeacherAssignmentStartDateRequest;
    const response = await ClassService.updateTeacherAssignmentStartDate(
      c.var.admin,
      { ...request, id: assignmentId, class_id: classId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkUpdateTeacherAssignmentStartDates(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const classId = c.req.param("id");
    if (!classId) throw new ResponseError(400, "Class ID is required in parameter");
    const request = (await c.req.json()) as BulkUpdateClassTeacherAssignmentStartDateRequest;
    const response = await ClassService.bulkUpdateTeacherAssignmentStartDates(
      c.var.admin,
      { ...request, class_id: classId },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async bulkMoveTeacherAssignments(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const classId = c.req.param("id");

    if (!classId) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const request = (await c.req.json()) as BulkMoveClassTeacherAssignmentRequest;

    const response = await ClassService.bulkMoveTeacherAssignments(
      admin,
      { ...request, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async bulkEndTeacherAssignments(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const classId = c.req.param("id");

    if (!classId) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const request = (await c.req.json()) as BulkEndClassTeacherAssignmentRequest;

    const response = await ClassService.bulkEndTeacherAssignments(
      admin,
      { ...request, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async bulkRemoveTeacherAssignments(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const classId = c.req.param("id");

    if (!classId) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const request = (await c.req.json()) as BulkRemoveClassTeacherAssignmentRequest;

    const response = await ClassService.bulkRemoveTeacherAssignments(
      admin,
      { ...request, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async bulkReopenTeacherAssignments(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const classId = c.req.param("id");

    if (!classId) {
      throw new ResponseError(400, "Class ID is required in parameter");
    }

    const request = (await c.req.json()) as BulkReopenClassTeacherAssignmentRequest;

    const response = await ClassService.bulkReopenTeacherAssignments(
      admin,
      { ...request, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async removeTeacherAssignment(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const classId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");

    if (!classId || !assignmentId) {
      throw new ResponseError(
        400,
        "Class ID and assignment ID are required in parameter",
      );
    }

    await ClassService.removeTeacherAssignment(
      admin,
      { id: assignmentId, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: null });
  }

  static async reopenTeacherAssignment(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const classId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");

    if (!classId || !assignmentId) {
      throw new ResponseError(
        400,
        "Class ID and assignment ID are required in parameter",
      );
    }

    const response = await ClassService.reopenTeacherAssignment(
      admin,
      { id: assignmentId, class_id: classId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: SearchClassRequest = {
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
      search: c.req.query("search"),
      grade_id: c.req.query("grade_id"),
      academic_year_id: c.req.query("academic_year_id"),
      status: c.req.query("status") as ClassStatus | undefined,
      sort_by: c.req.query("sort_by") as ClassSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    if (Number.isNaN(request.page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(request.size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await ClassService.search(admin, request);

    return c.json(response);
  }
}
