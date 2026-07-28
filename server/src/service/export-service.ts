import {
  AcademicYearStatus,
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
import {
  toHealthNoteExportRow,
  toHealthNoteResponse,
  type HealthNoteExportRow,
} from "../model/health-note-model";
import {
  toVaccineRecordExportRow,
  toVaccineRecordResponse,
  type VaccineRecordExportRow,
} from "../model/vaccine-record-model";
import {
  toParentGuardianExportRow,
  toParentGuardianResponse,
  type ParentGuardianExportRow,
} from "../model/parent-guardian-model";
import {
  toConsentExportRow,
  toConsentResponse,
  type ConsentExportRow,
} from "../model/consent-model";
import {
  toPCActivityExportRow,
  toPCActivityResponse,
  type PCActivityExportRow,
} from "../model/pc-activity-model";
import {
  toClassRosterExportRow,
  type ClassRosterExportRow,
} from "../model/enrollment-model";
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
  generateMultiSheetExportFile,
  toPlainSheet,
  type ExportColumn,
  type PlainExportSheet,
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
];

const STUDENT_SENSITIVE_COLUMNS: ExportColumn<StudentExportRow>[] = [
  { header: "Birth Place", key: "birth_place" },
  { header: "Birth Date", key: "birth_date" },
  { header: "Photo URL", key: "photo_url" },

  { header: "Current Class ID", key: "current_class_id" },
  { header: "Graduation Grade", key: "graduation_grade" },
  { header: "Leave Year", key: "leave_year" },
  { header: "SN", key: "sn" },
  { header: "Pickup Drop Service", key: "pickup_drop_service" },
  { header: "Catering Service", key: "catering_service" },
  { header: "PSB Guide", key: "psb_guide" },

  { header: "Blood Type", key: "blood_type" },
  { header: "Needs Assistance", key: "needs_assistance" },
];

const HEALTH_NOTE_COLUMNS: ExportColumn<HealthNoteExportRow>[] = [
  { header: "Student NIS", key: "student_nis" },
  { header: "Student Name", key: "student_full_name" },
  { header: "Category", key: "category" },
  { header: "Description", key: "description" },
  { header: "Status", key: "status" },
  { header: "Noted Date", key: "noted_date" },
  { header: "Resolved Date", key: "resolved_date" },
];

const VACCINE_RECORD_COLUMNS: ExportColumn<VaccineRecordExportRow>[] = [
  { header: "Student NIS", key: "student_nis" },
  { header: "Student Name", key: "student_full_name" },
  { header: "Vaccine Type", key: "vaccine_type" },
  { header: "Received", key: "received" },
  { header: "Date", key: "date" },
];

const PARENT_GUARDIAN_COLUMNS: ExportColumn<ParentGuardianExportRow>[] = [
  { header: "Student NIS", key: "student_nis" },
  { header: "Student Name", key: "student_full_name" },
  { header: "Type", key: "type" },
  { header: "Parent/Guardian Name", key: "parent_full_name" },
  { header: "Phone", key: "phone" },
  { header: "Email", key: "email" },
  { header: "Address", key: "address" },
  { header: "Is Primary", key: "is_primary" },
];

const CONSENT_COLUMNS: ExportColumn<ConsentExportRow>[] = [
  { header: "Student NIS", key: "student_nis" },
  { header: "Student Name", key: "student_full_name" },
  { header: "Consent Type", key: "consent_type" },
  { header: "Status", key: "status" },
  { header: "Consent Date", key: "consent_date" },
  { header: "Signed By", key: "signed_by" },
  { header: "Validity Period", key: "validity_period" },
];

const PC_ACTIVITY_COLUMNS: ExportColumn<PCActivityExportRow>[] = [
  { header: "Student NIS", key: "student_nis" },
  { header: "Student Name", key: "student_full_name" },
  { header: "Day", key: "day" },
  { header: "Activity", key: "activity" },
  { header: "Academic Year ID", key: "academic_year_id" },
];

const CLASS_ROSTER_COLUMNS: ExportColumn<ClassRosterExportRow>[] = [
  { header: "NIS", key: "nis" },
  { header: "Full Name", key: "full_name" },
  { header: "Grade Level", key: "grade_level" },
  { header: "Enrollment Status", key: "enrollment_status" },
  { header: "Start Date", key: "start_date" },
  { header: "End Date", key: "end_date" },
];

const EMPLOYEE_BASE_COLUMNS: ExportColumn<EmployeeExportRow>[] = [
  { header: "ID", key: "id" },
  { header: "Employee ID", key: "employee_id" },
  { header: "Full Name", key: "full_name" },
  { header: "Nick Name", key: "nick_name" },
  { header: "Email", key: "email" },
  { header: "Unit", key: "unit" },
  { header: "Job Position", key: "job_position" },
  { header: "Job Level", key: "job_level" },
  { header: "Building", key: "building" },
  { header: "Join Date", key: "join_date" },
  { header: "Status", key: "status" },
  { header: "Employment Type", key: "employment_type" },
  { header: "Created At", key: "created_at" },
];

const EMPLOYEE_SENSITIVE_COLUMNS: ExportColumn<EmployeeExportRow>[] = [
  { header: "Mobile Phone", key: "mobile_phone" },
  { header: "Residential Address", key: "residential_address" },
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

async function resolveRosterAcademicYear(
  requestedId?: string,
): Promise<{ id: string; name: string } | null> {
  if (requestedId) {
    return prismaClient.academicYear.findUnique({
      where: { id: requestedId },
      select: { id: true, name: true },
    });
  }
  return prismaClient.academicYear.findFirst({
    where: { status: AcademicYearStatus.ACTIVE },
    select: { id: true, name: true },
  });
}

function sheetSafeName(raw: string, used: Set<string>): string {
  const cleaned = raw.replace(/[\\/?*[\]:]/g, "-").trim() || "Sheet";
  let candidate = cleaned.slice(0, 31);
  let suffix = 1;
  while (used.has(candidate)) {
    const suffixText = `~${++suffix}`;
    candidate = `${cleaned.slice(0, 31 - suffixText.length)}${suffixText}`;
  }
  used.add(candidate);
  return candidate;
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
    const rosterAcademicYear =
      includeSensitive && exportRequest.format === "xlsx"
        ? await resolveRosterAcademicYear(exportRequest.roster_academic_year_id)
        : null;

    const whereClause = buildStudentSearchWhere(exportRequest);
    const persons = await prismaClient.person.findMany({
      where: whereClause,
      orderBy: buildStudentOrderBy(
        exportRequest.sort_by || "created_at",
        exportRequest.sort_order || "desc",
      ),
      include: {
        student: {
          include: {
            current_grade: true,
            join_grade: true,
            health: true,
            health_notes: { where: { deleted_at: null } },
            vaccine_records: { where: { deleted_at: null } },
            parents: { where: { deleted_at: null } },
            consents: { where: { deleted_at: null } },
            pc: { where: { deleted_at: null } },
            ...(rosterAcademicYear && {
              enrollments: {
                where: {
                  academic_year_id: rosterAcademicYear.id,
                  deleted_at: null,
                },
              },
            }),
          },
        },
      },
    });

    const rows: StudentExportRow[] = [];
    const healthNoteRows: HealthNoteExportRow[] = [];
    const vaccineRecordRows: VaccineRecordExportRow[] = [];
    const parentGuardianRows: ParentGuardianExportRow[] = [];
    const consentRows: ConsentExportRow[] = [];
    const pcActivityRows: PCActivityExportRow[] = [];
    const classRosterRows = new Map<string, ClassRosterExportRow[]>();

    for (const person of persons) {
      const student = person.student;
      if (!student) continue;
      const response = includeSensitive
        ? toStudentDetailResponse(person)
        : toStudentResponse(person);
      rows.push(toStudentExportRow(response));

      const studentRef = { nis: student.nis, full_name: person.full_name };

      if (!includeSensitive) continue;

      if (rosterAcademicYear) {
        for (const enrollment of student.enrollments ?? []) {
          const className = enrollment.class_name_snapshot;
          const bucket = classRosterRows.get(className) ?? [];
          bucket.push(toClassRosterExportRow(enrollment, studentRef));
          classRosterRows.set(className, bucket);
        }
      }

      for (const note of student.health_notes) {
        healthNoteRows.push(
          toHealthNoteExportRow(toHealthNoteResponse(note), studentRef),
        );
      }
      for (const vaccine of student.vaccine_records) {
        vaccineRecordRows.push(
          toVaccineRecordExportRow(
            toVaccineRecordResponse(vaccine),
            studentRef,
          ),
        );
      }
      for (const parent of student.parents) {
        parentGuardianRows.push(
          toParentGuardianExportRow(
            toParentGuardianResponse(parent, admin),
            studentRef,
          ),
        );
      }
      for (const consent of student.consents) {
        consentRows.push(
          toConsentExportRow(toConsentResponse(consent), studentRef),
        );
      }
      for (const activity of student.pc) {
        pcActivityRows.push(
          toPCActivityExportRow(toPCActivityResponse(activity), studentRef),
        );
      }
    }

    const studentColumns = includeSensitive
      ? [...STUDENT_BASE_COLUMNS, ...STUDENT_SENSITIVE_COLUMNS]
      : STUDENT_BASE_COLUMNS;
    const sheets: PlainExportSheet[] = [
      toPlainSheet<StudentExportRow>({
        name: "Students",
        rows,
        columns: studentColumns,
      }),
    ];
    if (includeSensitive) {
      sheets.push(
        toPlainSheet<HealthNoteExportRow>({
          name: "HealthNotes",
          rows: healthNoteRows,
          columns: HEALTH_NOTE_COLUMNS,
        }),
        toPlainSheet<VaccineRecordExportRow>({
          name: "VaccineRecords",
          rows: vaccineRecordRows,
          columns: VACCINE_RECORD_COLUMNS,
        }),
        toPlainSheet<ParentGuardianExportRow>({
          name: "ParentsGuardians",
          rows: parentGuardianRows,
          columns: PARENT_GUARDIAN_COLUMNS,
        }),
        toPlainSheet<ConsentExportRow>({
          name: "Consents",
          rows: consentRows,
          columns: CONSENT_COLUMNS,
        }),
        toPlainSheet<PCActivityExportRow>({
          name: "PCActivities",
          rows: pcActivityRows,
          columns: PC_ACTIVITY_COLUMNS,
        }),
      );
    }

    const rosterSheetNames: string[] = [];
    if (rosterAcademicYear) {
      const usedNames = new Set<string>(sheets.map((sheet) => sheet.name));
      const classNames = [...classRosterRows.keys()].sort((a, b) =>
        a.localeCompare(b),
      );
      for (const className of classNames) {
        const sheetName = sheetSafeName(
          `${className} - ${rosterAcademicYear.name}`,
          usedNames,
        );
        rosterSheetNames.push(sheetName);
        sheets.push(
          toPlainSheet<ClassRosterExportRow>({
            name: sheetName,
            rows: classRosterRows.get(className)!,
            columns: CLASS_ROSTER_COLUMNS,
          }),
        );
      }
    }

    const buffer = await generateMultiSheetExportFile(
      sheets,
      exportRequest.format,
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
        ...(exportRequest.format === "xlsx" &&
          sheets.length > 1 && {
            included_sheets: sheets.map((sheet) => sheet.name),
          }),
        ...(rosterAcademicYear && {
          roster_academic_year: rosterAcademicYear.name,
        }),
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
          include: {
            unit: true,
            job_position: true,
            job_level: true,
            building: true,
          },
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
