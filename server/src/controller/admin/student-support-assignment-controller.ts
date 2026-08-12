import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type { AssignStudentSupportRequest } from "../../model/student-support-assignment-model";
import { StudentSupportAssignmentService } from "../../service/student-support-assignment-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class StudentSupportAssignmentController {
  static async getList(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const response = await StudentSupportAssignmentService.getList(admin, {
      student_id: studentId,
    });

    return c.json({ data: response });
  }

  static async getCaseload(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const response = await StudentSupportAssignmentService.getCaseload(admin);

    return c.json({ data: response });
  }

  static async getActiveStudentIds(
    c: Context<{ Variables: AdminVariables }>,
  ) {
    const admin = c.var.admin;
    const studentIds = (c.req.query("student_ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const response =
      await StudentSupportAssignmentService.getActiveSupportStudentIds(
        admin,
        { student_ids: studentIds },
      );

    return c.json({ data: response });
  }

  static async assign(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");

    if (!studentId) {
      throw new ResponseError(400, "Student ID is required in parameter");
    }

    const request = (await c.req.json()) as AssignStudentSupportRequest;

    const response = await StudentSupportAssignmentService.assign(
      admin,
      { ...request, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }

  static async end(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    const studentId = c.req.param("id");
    const assignmentId = c.req.param("assignmentId");

    if (!studentId || !assignmentId) {
      throw new ResponseError(
        400,
        "Student ID and assignment ID are required in parameter",
      );
    }

    const response = await StudentSupportAssignmentService.end(
      admin,
      { id: assignmentId, student_id: studentId },
      getAuditRequestContext(c),
    );

    return c.json({ data: response });
  }
}
