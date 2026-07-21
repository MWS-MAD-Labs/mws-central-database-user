import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CloseEnrollmentRequest,
  CreateEnrollmentRequest,
  EnrollmentSortField,
  PromoteEnrollmentRequest,
  SearchEnrollmentRequest,
  TransferEnrollmentRequest,
} from "../../model/enrollment-model";
import { EnrollmentService } from "../../service/enrollment-service";
import { ResponseError } from "../../error/response-error";
import type { EnrollmentStatus } from "../../generated/prisma/client";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class EnrollmentController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const body = (await c.req.json()) as CreateEnrollmentRequest;

    const response = await EnrollmentService.create(
      admin,
      { ...body, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async promote(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const enrollmentId = c.req.param("enrollmentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!enrollmentId) {
      throw new ResponseError(400, "Enrollment ID is required in parameter");
    }

    const body = (await c.req.json()) as PromoteEnrollmentRequest;

    const response = await EnrollmentService.promote(
      admin,
      { ...body, id: enrollmentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async transfer(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const enrollmentId = c.req.param("enrollmentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!enrollmentId) {
      throw new ResponseError(400, "Enrollment ID is required in parameter");
    }

    const body = (await c.req.json()) as TransferEnrollmentRequest;

    const response = await EnrollmentService.transfer(
      admin,
      { ...body, id: enrollmentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async close(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const enrollmentId = c.req.param("enrollmentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!enrollmentId) {
      throw new ResponseError(400, "Enrollment ID is required in parameter");
    }

    const body = (await c.req.json()) as CloseEnrollmentRequest;

    const response = await EnrollmentService.close(
      admin,
      { ...body, id: enrollmentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const enrollmentId = c.req.param("enrollmentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!enrollmentId) {
      throw new ResponseError(400, "Enrollment ID is required in parameter");
    }

    const response = await EnrollmentService.remove(
      admin,
      { id: enrollmentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const enrollmentId = c.req.param("enrollmentId");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }
    if (!enrollmentId) {
      throw new ResponseError(400, "Enrollment ID is required in parameter");
    }

    const response = await EnrollmentService.restore(
      admin,
      { id: enrollmentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async getHistory(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const isDeletedQuery = c.req.query("is_deleted");

    const response = await EnrollmentService.getHistory(admin, {
      student_id: studentId,
      is_deleted: isDeletedQuery ? isDeletedQuery === "true" : undefined,
    });

    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: SearchEnrollmentRequest = {
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
      student_id: c.req.query("student_id"),
      class_id: c.req.query("class_id"),
      academic_year_id: c.req.query("academic_year_id"),
      status: c.req.query("status") as EnrollmentStatus | undefined,
      is_deleted: c.req.query("is_deleted")
        ? c.req.query("is_deleted") === "true"
        : undefined,
      sort_by: c.req.query("sort_by") as EnrollmentSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    if (Number.isNaN(request.page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(request.size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await EnrollmentService.search(admin, request);

    return c.json(response);
  }
}
