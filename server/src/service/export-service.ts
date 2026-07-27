import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import type { AuditRequestContext } from "../model/audit-log-model";
import type {
  ExportEmployeeRequest,
  ExportStudentRequest,
} from "../model/export-model";
import {
  toEmployeeDetailResponse,
  toEmployeeExportRow,
  toEmployeeResponse,
  type EmployeeExportRow,
} from "../model/employee-model";
import {
  buildStudentOrderBy,
  toStudentDetailResponse,
  toStudentExportRow,
  toStudentResponse,
  type StudentExportRow,
} from "../model/student-model";
import { AuditService } from "./audit-service";
import {
  buildEmployeeOrderBy,
  buildEmployeeSearchWhere,
} from "./employee-service";
import { buildStudentSearchWhere } from "./student-service";
import { canViewSensitiveData } from "../utils/sensitive-data";
import {
  exportMimeType,
  generateExportFile,
  type ExportColumn,
} from "../utils/export-file";
import { ExportValidation } from "../validation/export-validation";
import { Validation } from "../validation/validation";

const STUDENT_BASE_COLUMNS: ExportColumn<StudentExportRow>[] = [
  { header: "ID", key: "id" },
  { header: "Full Name", key: "full_name" },
  { header: "Nick Name", key: "nick_name" },
  { header: "Email", key: "email" },
  { header: "Gender", key: "gender" },
  { header: "Religion", key: "religion" },
  { header: "NIS", key: "nis" },
  { header: "NISN", key: "nisn" },
  { header: "Current Grade", key: "current_grade" },
  { header: "Join Academic Year ID", key: "join_academic_year_id" },
  { header: "Join Grade", key: "join_grade" },
  { header: "Previous School", key: "previous_school" },
  { header: "Status", key: "status" },
  { header: "Created At", key: "created_at" },
  { header: "Current Class ID", key: "current_class_id" },
  { header: "Graduation Grade", key: "graduation_grade" },
  { header: "Leave Year", key: "leave_year" },
  { header: "SN", key: "sn" },
  { header: "Pickup Drop Service", key: "pickup_drop_service" },
  { header: "Catering Service", key: "catering_service" },
  { header: "PSB Guide", key: "psb_guide" },
];

const STUDENT_SENSITIVE_COLUMNS: ExportColumn<StudentExportRow>[] = [
  { header: "Birth Place", key: "birth_place" },
  { header: "Birth Date", key: "birth_date" },
  { header: "Photo URL", key: "photo_url" },
];

const EMPLOYEE_BASE_COLUMNS: ExportColumn<EmployeeExportRow>[] = [
  { header: "ID", key: "id" },
  { header: "Employee ID", key: "employee_id" },
  { header: "Full Name", key: "full_name" },
  { header: "Nick Name", key: "nick_name" },
  { header: "Email", key: "email" },
  { header: "Mobile Phone", key: "mobile_phone" },
  { header: "Residential Address", key: "residential_address" },
  { header: "Unit", key: "unit" },
  { header: "Job Position", key: "job_position" },
  { header: "Job Level", key: "job_level" },
  { header: "Building", key: "building" },
  { header: "Join Date", key: "join_date" },
  { header: "Status", key: "status" },
  { header: "Employment Type", key: "employment_type" },
  { header: "Created At", key: "created_at" },
];

// Employee's sensitive tier is hard SUPER_ADMIN-only, not the
// can_view_sensitive_data flag used for students - see toEmployeeDetailResponse.
const EMPLOYEE_SENSITIVE_COLUMNS: ExportColumn<EmployeeExportRow>[] = [
  { header: "Gender", key: "gender" },
  { header: "Religion", key: "religion" },
  { header: "Birth Place", key: "birth_place" },
  { header: "Birth Date", key: "birth_date" },
  { header: "Marital Status", key: "marital_status" },
  { header: "NIK", key: "nik" },
  { header: "NPWP", key: "npwp" },
  { header: "Bank Account Number", key: "bank_account_number" },
  { header: "BPJS Number", key: "bpjs_number" },
];

function exportFileName(entity: string, format: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${entity}-export-${date}.${format}`;
}

export class ExportService {
  static async exportStudents(
    admin: AdminUser,
    request: ExportStudentRequest,
    context: AuditRequestContext = {},
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const exportRequest = Validation.validate(
      ExportValidation.STUDENT,
      request,
    );
    const includeSensitive = canViewSensitiveData(admin);

    const whereClause = buildStudentSearchWhere(exportRequest);
    const persons = await prismaClient.person.findMany({
      where: whereClause,
      orderBy: buildStudentOrderBy(
        exportRequest.sort_by || "created_at",
        exportRequest.sort_order || "desc",
      ),
      include: {
        student: { include: { current_grade: true, join_grade: true } },
      },
    });

    const rows: StudentExportRow[] = [];
    for (const person of persons) {
      if (!person.student) continue;
      const response = includeSensitive
        ? toStudentDetailResponse(person)
        : toStudentResponse(person);
      rows.push(toStudentExportRow(response));
    }

    const columns = includeSensitive
      ? [...STUDENT_BASE_COLUMNS, ...STUDENT_SENSITIVE_COLUMNS]
      : STUDENT_BASE_COLUMNS;

    const buffer = await generateExportFile(
      rows,
      columns,
      exportRequest.format,
      "Students",
    );

    await AuditService.record({
      action: AuditAction.EXPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Student",
        format: exportRequest.format,
        row_count: rows.length,
        included_sensitive_data: includeSensitive,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      buffer,
      fileName: exportFileName("students", exportRequest.format),
      mimeType: exportMimeType(exportRequest.format),
    };
  }

  static async exportEmployees(
    admin: AdminUser,
    request: ExportEmployeeRequest,
    context: AuditRequestContext = {},
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const exportRequest = Validation.validate(
      ExportValidation.EMPLOYEE,
      request,
    );
    // Deliberately not canViewSensitiveData - employee's sensitive tier
    // (NIK/NPWP/bank/BPJS) is hard SUPER_ADMIN-only, kept separate from the
    // can_view_sensitive_data flag reserved for student-side data.
    const includeSensitive = admin.role === AdminRole.SUPER_ADMIN;

    const whereClause = buildEmployeeSearchWhere(admin, exportRequest);
    const persons = await prismaClient.person.findMany({
      where: whereClause,
      orderBy: buildEmployeeOrderBy(
        exportRequest.sort_by || "created_at",
        exportRequest.sort_order || "desc",
      ),
      include: {
        employee: {
          include: { unit: true, job_position: true, job_level: true },
        },
      },
    });

    const rows: EmployeeExportRow[] = [];
    for (const person of persons) {
      if (!person.employee) continue;
      const response = includeSensitive
        ? toEmployeeDetailResponse(person, admin)
        : toEmployeeResponse(person, admin);
      rows.push(toEmployeeExportRow(response));
    }

    const columns = includeSensitive
      ? [...EMPLOYEE_BASE_COLUMNS, ...EMPLOYEE_SENSITIVE_COLUMNS]
      : EMPLOYEE_BASE_COLUMNS;

    const buffer = await generateExportFile(
      rows,
      columns,
      exportRequest.format,
      "Employees",
    );

    await AuditService.record({
      action: AuditAction.EXPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Employee",
        format: exportRequest.format,
        row_count: rows.length,
        included_sensitive_data: includeSensitive,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      buffer,
      fileName: exportFileName("employees", exportRequest.format),
      mimeType: exportMimeType(exportRequest.format),
    };
  }
}
