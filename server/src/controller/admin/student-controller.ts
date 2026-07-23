import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateStudentRequest,
  SearchStudentRequest,
  StudentSortField,
  UpdateStudentRequest,
} from "../../model/student-model";
import { StudentService } from "../../service/student-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type {
  ConsentStatus,
  Gender,
  PCDay,
  Religion,
  StudentStatus,
} from "../../generated/prisma/client";

export class StudentController {
  static async create(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const request = (await c.req.json()) as CreateStudentRequest;

    const response = await StudentService.create(
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
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const request = (await c.req.json()) as UpdateStudentRequest;

    const response = await StudentService.update(
      admin,
      { ...request, id },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async get(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentService.get(admin, { id });

    return c.json({ data: response });
  }

  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: SearchStudentRequest = {
      page: c.req.query("page") ? Number(c.req.query("page")) : 1,
      size: c.req.query("size") ? Number(c.req.query("size")) : 10,
      search: c.req.query("search"),
      gender: c.req.query("gender") as Gender | undefined,
      religion: c.req.query("religion") as Religion | undefined,
      status: c.req.query("status") as StudentStatus | undefined,
      current_grade_id: c.req.query("current_grade_id"),
      current_class_id: c.req.query("current_class_id"),
      join_academic_year_id: c.req.query("join_academic_year_id"),
      leave_year: c.req.query("leave_year"),
      pickup_drop_service: c.req.query("pickup_drop_service")
        ? c.req.query("pickup_drop_service") === "true"
        : undefined,
      catering_service: c.req.query("catering_service")
        ? c.req.query("catering_service") === "true"
        : undefined,
      psb_guide: c.req.query("psb_guide")
        ? c.req.query("psb_guide") === "true"
        : undefined,
      consent_status: c.req.query("consent_status") as
        | ConsentStatus
        | undefined,
      pc_activity_day: c.req.query("pc_activity_day") as PCDay | undefined,
      is_deleted: c.req.query("is_deleted")
        ? c.req.query("is_deleted") === "true"
        : undefined,
      sort_by: c.req.query("sort_by") as StudentSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    if (Number.isNaN(request.page)) {
      throw new ResponseError(400, "page must be a valid number");
    }
    if (Number.isNaN(request.size)) {
      throw new ResponseError(400, "size must be a valid number");
    }

    const response = await StudentService.search(admin, request);

    return c.json(response);
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentService.remove(
      admin,
      { id },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async restore(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const id = c.req.param("id");

    if (!id) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentService.restore(
      admin,
      { id },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
