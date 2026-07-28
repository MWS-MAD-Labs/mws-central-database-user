import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { ExportService } from "../../service/export-service";
import { getAuditRequestContext } from "../../utils/audit-request-context";
import type { ExportEmployeeRequest, ExportStudentRequest } from "../../model/export-model";
import type {
  ConsentStatus,
  EmployeeStatus,
  Gender,
  PCDay,
  Religion,
  StudentStatus,
} from "../../generated/prisma/client";
import type { StudentSortField } from "../../model/student-model";
import type { EmployeeSortField } from "../../model/employee-model";

export class ExportController {
  static async exportStudents(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: ExportStudentRequest = {
      format: c.req.query("format") as ExportStudentRequest["format"],
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
      roster_academic_year_id: c.req.query("roster_academic_year_id"),
    };

    const { buffer, fileName, mimeType } = await ExportService.exportStudents(
      admin,
      request,
      getAuditRequestContext(c),
    );

    return c.body(new Uint8Array(buffer), 200, {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
  }

  static async exportEmployees(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;

    const request: ExportEmployeeRequest = {
      format: c.req.query("format") as ExportEmployeeRequest["format"],
      search: c.req.query("search"),
      status: c.req.query("status") as EmployeeStatus | undefined,
      unit_id: c.req.query("unit_id"),
      job_position_id: c.req.query("job_position_id"),
      job_level_id: c.req.query("job_level_id"),
      building_id: c.req.query("building_id"),
      gender: c.req.query("gender") as Gender | undefined,
      religion: c.req.query("religion") as Religion | undefined,
      join_date_start: c.req.query("join_date_start"),
      join_date_end: c.req.query("join_date_end"),
      is_deleted: c.req.query("is_deleted")
        ? c.req.query("is_deleted") === "true"
        : undefined,
      sort_by: c.req.query("sort_by") as EmployeeSortField | undefined,
      sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
    };

    const { buffer, fileName, mimeType } =
      await ExportService.exportEmployees(
        admin,
        request,
        getAuditRequestContext(c),
      );

    return c.body(new Uint8Array(buffer), 200, {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
  }
}
