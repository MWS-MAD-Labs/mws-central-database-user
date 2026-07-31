import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  ImportStatus,
  ImportType,
  StudentEntryType,
  StudentStatus,
  type AdminUser,
} from "../generated/prisma/client";
import { ZodError } from "zod";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toImportJobResponse,
  toEmployeeImportJobResponse,
  normalizeGender,
  normalizeReligion,
  parseBoolean,
  type CommitStudentImportResponse,
  type CommitEmployeeImportResponse,
  type EmployeeImportJobResponse,
  type ImportEmployeeFieldKey,
  type ImportJobResponse,
  type ImportStudentFieldKey,
  type ImportSummary,
  type PreviewEmployeeImportResponse,
  type PreviewStudentImportResponse,
  type RollbackEmployeeImportResponse,
  type RollbackStudentImportResponse,
  type RollbackSummary,
  type StagedConsent,
  type StagedEmployeeRow,
  type StagedHealthNote,
  type StagedHealthRecord,
  type StagedParentGuardian,
  type StagedPCActivity,
  type StagedRelationWrite,
  type StagedStudentRow,
  type StagedVaccineRecord,
  type StagedEnrollment,
} from "../model/import-model";
import type {
  CreateStudentRequest,
  UpdateStudentRequest,
} from "../model/student-model";
import type {
  CreateEmployeeRequest,
  UpdateEmployeeRequest,
} from "../model/employee-model";
import type {
  ConsentStatus,
  ConsentType,
  HealthNoteCategory,
  ParentType,
  PCDay,
  VaccineType,
} from "../generated/prisma/client";
import { AuditService } from "./audit-service";
import { StudentService } from "./student-service";
import { EmployeeService } from "./employee-service";
import { ParentGuardianService } from "./parent-guardian-service";
import { HealthRecordService } from "./health-record-service";
import { HealthNoteService } from "./health-note-service";
import { ConsentService } from "./consent-service";
import { PCActivityService } from "./pc-activity-service";
import { VaccineRecordService } from "./vaccine-record-service";
import { EnrollmentService } from "./enrollment-service";
import { TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS } from "./student-service";
import { parseImportFile, type SheetSelector } from "../utils/import-file";
import { computeNisPrefix } from "../utils/nis-generator";
import { assertUnitJobLevelCompatible } from "../utils/employee-role-rules";
import { ImportValidation } from "../validation/import-validation";

type MappedRowInput = {
  row_number: number;
  mapped: Record<string, string>;
  source_raw?: Record<string, string>;
};

type ResolvedRows = {
  rows: StagedStudentRow[];
  gradeIdByName: Map<string, string>;
  academicYearIdByName: Map<string, string>;
  fallbackAcademicYearId: string | null;
  classIdByName: Map<string, string>;
};

async function recordUnauthorizedImportAction(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
): Promise<void> {
  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: { reason: `blocked student import ${action}` },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });
}
// SUPER_ADMIN-only for every step - preview echoes back raw staged data
// (birth dates, NIK/NPWP/bank, ...) verbatim, so a DATABASE_ADMIN could see
// it just by running someone else's file.
async function assertSuperAdminImport(
  admin: AdminUser,
  action: string,
  context: AuditRequestContext,
): Promise<void> {
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    await recordUnauthorizedImportAction(admin, action, context);
    throw new ResponseError(
      403,
      "Forbidden: Only Super Admin can use the import feature",
    );
  }
}

function buildRelationSubRows(
  mapped: Record<string, string>,
): Pick<
  StagedStudentRow,
  | "parents"
  | "health"
  | "health_notes"
  | "consents"
  | "pc_activities"
  | "vaccine_records"
  | "enrollment"
> {
  const parents: StagedParentGuardian[] = [];
  if (mapped.father_name) {
    parents.push({
      type: "FATHER",
      full_name: mapped.father_name,
      phone: mapped.father_phone || null,
      email: mapped.father_email || null,
      address: mapped.parent_address || null,
      errors: [],
      committed_id: null,
    });
  }
  if (mapped.mother_name) {
    parents.push({
      type: "MOTHER",
      full_name: mapped.mother_name,
      phone: mapped.mother_phone || null,
      email: mapped.mother_email || null,
      address: mapped.parent_address || null,
      errors: [],
      committed_id: null,
    });
  }

  const health: StagedHealthRecord | null =
    mapped.blood_type || mapped.special_needs
      ? {
          blood_type: mapped.blood_type || null,
          needs_assistance: Boolean(mapped.special_needs),
          errors: [],
          committed_id: null,
        }
      : null;

  const health_notes: StagedHealthNote[] = [];
  if (mapped.health_info) {
    health_notes.push({
      category: "HEALTH_INFO",
      description: mapped.health_info,
      errors: [],
      committed_id: null,
    });
  }
  if (mapped.special_needs) {
    health_notes.push({
      category: "SPECIAL_NEEDS",
      description: mapped.special_needs,
      errors: [],
      committed_id: null,
    });
  }

  const consents: StagedConsent[] = [];
  if (mapped.media_consent_sign || mapped.media_consent_yes) {
    consents.push({
      consent_type: "MEDIA_CONSENT",
      signed_by: mapped.media_consent_sign || null,
      status:
        mapped.media_consent_yes?.trim().toUpperCase() === "YES"
          ? "SIGNED"
          : "PENDING",
      errors: [],
      committed_id: null,
    });
  }
  if (mapped.parent_consent_sign) {
    consents.push({
      consent_type: "PARENT_CONSENT",
      signed_by: mapped.parent_consent_sign,
      status: "SIGNED",
      errors: [],
      committed_id: null,
    });
  }

  const pcDayFields: [StagedPCActivity["day"], string][] = [
    ["MONDAY", "pc_monday"],
    ["TUESDAY", "pc_tuesday"],
    ["WEDNESDAY", "pc_wednesday"],
    ["THURSDAY", "pc_thursday"],
  ];
  const pc_activities: StagedPCActivity[] = [];
  for (const [day, field] of pcDayFields) {
    if (mapped[field]) {
      pc_activities.push({
        day,
        activity: mapped[field],
        errors: [],
        committed_id: null,
      });
    }
  }

  const vaccine_records: StagedVaccineRecord[] = [];
  if (mapped.vaccine_type) {
    vaccine_records.push({
      vaccine_type: mapped.vaccine_type,
      received:
        mapped.vaccine_received !== undefined
          ? parseBoolean(mapped.vaccine_received)
          : true,
      date: mapped.vaccine_date || null,
      errors: [],
      committed_id: null,
    });
  }

  const enrollment: StagedEnrollment | null = mapped.current_class
    ? {
        class_name: mapped.current_class,
        start_date: mapped.current_class_start_date || null,
        end_date: mapped.current_class_end_date || null,
        errors: [],
        committed_id: null,
      }
    : null;

  return {
    parents,
    health,
    health_notes,
    consents,
    pc_activities,
    vaccine_records,
    enrollment,
  };
}

function describeCommitError(error: unknown): string {
  if (error instanceof ResponseError) return error.message;
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join(", ");
  }
  return "unexpected error";
}

async function tryCreateRelation<T extends StagedRelationWrite>(
  item: T,
  rowErrors: string[],
  label: string,
  create: () => Promise<{ id: string }>,
): Promise<void> {
  try {
    const result = await create();
    item.committed_id = result.id;
  } catch (error) {
    const message = describeCommitError(error);
    item.errors.push(message);
    rowErrors.push(`${label} failed: ${message}`);
  }
}

async function tryRemoveRelation<T extends StagedRelationWrite>(
  item: T,
  rowErrors: string[],
  label: string,
  remove: () => Promise<unknown>,
): Promise<void> {
  if (!item.committed_id) return;
  try {
    await remove();
    item.committed_id = null;
  } catch (error) {
    rowErrors.push(
      `Rollback of ${label} failed: ${describeCommitError(error)}`,
    );
  }
}

function summarize(
  rows: { action: "CREATE" | "UPDATE" | null; errors: string[] }[],
): ImportSummary {
  const errorRows = rows.filter((row) => row.errors.length > 0);
  return {
    total_rows: rows.length,
    valid_rows: rows.length - errorRows.length,
    error_rows: errorRows.length,
    create_count: rows.filter(
      (row) => row.action === "CREATE" && row.errors.length === 0,
    ).length,
    update_count: rows.filter(
      (row) => row.action === "UPDATE" && row.errors.length === 0,
    ).length,
  };
}

function buildSourceRaw(
  headers: string[],
  values: string[],
): Record<string, string> {
  return Object.fromEntries(
    headers.map((header, index) => [header, (values[index] ?? "").trim()]),
  );
}

async function resolveStagedRows(
  inputs: MappedRowInput[],
): Promise<ResolvedRows> {
  const shapeErrors = new Map<number, string[]>();
  for (const { row_number, mapped } of inputs) {
    shapeErrors.set(
      row_number,
      ImportValidation.validateStudentRowShape(mapped),
    );
  }

  const nisValues = [
    ...new Set(inputs.map((r) => r.mapped.nis).filter(Boolean)),
  ];
  const emailValues = [
    ...new Set(inputs.map((r) => r.mapped.email).filter(Boolean)),
  ];
  const gradeNames = [
    ...new Set(
      inputs
        .map((r) => r.mapped.current_grade?.trim().toLowerCase())
        .filter(Boolean),
    ),
  ] as string[];
  const yearNames = [
    ...new Set(
      inputs
        .map((r) => r.mapped.join_academic_year?.trim().toLowerCase())
        .filter(Boolean),
    ),
  ] as string[];

  const [
    existingStudents,
    existingPersonsByEmail,
    grades,
    years,
    activeYear,
    classes,
  ] = await Promise.all([
    prismaClient.student.findMany({
      where: { nis: { in: nisValues } },
      include: { person: true },
    }),
    prismaClient.person.findMany({
      where: { email: { in: emailValues } },
      include: { student: true },
    }),
    prismaClient.grade.findMany(),
    prismaClient.academicYear.findMany(),
    prismaClient.academicYear.findFirst({
      where: { status: AcademicYearStatus.ACTIVE },
    }),
    prismaClient.class.findMany(),
  ]);

  const studentByNis = new Map(existingStudents.map((s) => [s.nis, s]));
  const personByEmail = new Map(
    existingPersonsByEmail.map((p) => [p.email, p]),
  );
  const gradeIdByName = new Map(
    grades
      .filter((g) => gradeNames.includes(g.name.trim().toLowerCase()))
      .map((g) => [g.name.trim().toLowerCase(), g.id]),
  );
  const gradeByName = new Map(
    grades.map((g) => [g.name.trim().toLowerCase(), g]),
  );
  const academicYearIdByName = new Map(
    years
      .filter((y) => yearNames.includes(y.name.trim().toLowerCase()))
      .map((y) => [y.name.trim().toLowerCase(), y.id]),
  );
  const academicYearByName = new Map(
    years.map((y) => [y.name.trim().toLowerCase(), y]),
  );
  // Class names are only unique per academic year (schema:
  // @@unique([name, academic_year_id])) - scope lookup to the active year,
  // matching "Current Class" semantics.
  const classIdByName = new Map(
    classes
      .filter((c) => c.academic_year_id === activeYear?.id)
      .map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  const nisCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  for (const { mapped } of inputs) {
    if (mapped.nis)
      nisCounts.set(mapped.nis, (nisCounts.get(mapped.nis) ?? 0) + 1);
    if (mapped.email)
      emailCounts.set(mapped.email, (emailCounts.get(mapped.email) ?? 0) + 1);
  }

  const rows: StagedStudentRow[] = inputs.map(
    ({ row_number, mapped, source_raw }) => {
      const errors = [...(shapeErrors.get(row_number) ?? [])];
      const warnings: string[] = [];

      if (mapped.nis && (nisCounts.get(mapped.nis) ?? 0) > 1) {
        errors.push(`Duplicate NIS within the file: ${mapped.nis}`);
      }
      if (mapped.email && (emailCounts.get(mapped.email) ?? 0) > 1) {
        errors.push(`Duplicate email within the file: ${mapped.email}`);
      }

      const matchedStudent = mapped.nis
        ? studentByNis.get(mapped.nis)
        : undefined;
      const action: StagedStudentRow["action"] = matchedStudent
        ? "UPDATE"
        : "CREATE";

      if (mapped.email) {
        const emailOwner = personByEmail.get(mapped.email);
        if (emailOwner && emailOwner.id !== matchedStudent?.person_id) {
          errors.push(
            `Email already registered to another person: ${mapped.email}`,
          );
        }
      }

      if (mapped.current_grade) {
        const gradeId = gradeIdByName.get(
          mapped.current_grade.trim().toLowerCase(),
        );
        if (!gradeId) {
          errors.push(`Grade not recognized: ${mapped.current_grade}`);
        }
      }

      const hasResolvedCurrentClass = Boolean(
        mapped.current_class &&
          classIdByName.has(mapped.current_class.trim().toLowerCase()),
      );
      if (mapped.current_class && !hasResolvedCurrentClass) {
        warnings.push(
          !activeYear
            ? `Current Class "${mapped.current_class}" can't be assigned - there is no active academic year right now. Mark one academic year ACTIVE first, then re-import.`
            : `Class not recognized in the active academic year (${activeYear.name}): ${mapped.current_class} - it may exist under a different academic year. Student will still be created without a class assignment.`,
        );
      }

      if (mapped.join_academic_year) {
        const yearId = academicYearIdByName.get(
          mapped.join_academic_year.trim().toLowerCase(),
        );
        if (!yearId) {
          errors.push(
            `Academic year not recognized: ${mapped.join_academic_year}`,
          );
        }
      } else if (action === "CREATE" && !activeYear) {
        errors.push(
          "No active academic year to default to - map a Join Academic Year column or activate one first",
        );
      }

      if (action === "CREATE" && mapped.nis) {
        const entryTypeValue = mapped.entry_type?.trim().toUpperCase();
        const entryType =
          entryTypeValue && entryTypeValue in StudentEntryType
            ? (entryTypeValue as StudentEntryType)
            : undefined;
        if (mapped.entry_type && !entryType) {
          errors.push(`Entry type not recognized: ${mapped.entry_type}`);
        }

        const grade = mapped.current_grade
          ? gradeByName.get(mapped.current_grade.trim().toLowerCase())
          : undefined;
        const academicYear = mapped.join_academic_year
          ? academicYearByName.get(
              mapped.join_academic_year.trim().toLowerCase(),
            )
          : (activeYear ?? undefined);

        // Only checked once grade/year/entry_type resolved cleanly, to avoid
        // stacking on an already-reported error.
        if (grade && academicYear && entryType) {
          try {
            const expectedPrefix = computeNisPrefix({
              academicYear,
              gradeLevel: grade.level,
              entryType,
            });
            if (!mapped.nis.startsWith(expectedPrefix)) {
              errors.push(
                `NIS does not match the expected pattern for this row's academic year/grade/entry type: expected prefix ${expectedPrefix}, got ${mapped.nis.slice(0, 4)}`,
              );
            }
          } catch (error) {
            errors.push(
              error instanceof ResponseError
                ? error.message
                : "Could not validate NIS pattern",
            );
          }
        }
      }

      if (
        action === "CREATE" &&
        mapped.status &&
        mapped.status.toUpperCase() === StudentStatus.ACTIVE
      ) {
        warnings.push(
          hasResolvedCurrentClass
            ? "Status ACTIVE ignored for a new student - created as REGISTERED, then activated automatically once the Current Class assignment commits."
            : "Status ACTIVE ignored for a new student - created as REGISTERED. Activate after assigning a class.",
        );
      }

      const relationSubRows =
        action === "CREATE"
          ? buildRelationSubRows(mapped)
          : {
              parents: [],
              health: null,
              health_notes: [],
              consents: [],
              pc_activities: [],
              vaccine_records: [],
              enrollment: null,
            };

      return {
        row_number,
        raw: mapped,
        source_raw: source_raw ?? mapped,
        action,
        matched_student_id: matchedStudent?.id ?? null,
        errors,
        warnings,
        committed_student_id: null,
        previous_values: null,
        ...relationSubRows,
      };
    },
  );

  return {
    rows,
    gradeIdByName,
    academicYearIdByName,
    fallbackAcademicYearId: activeYear?.id ?? null,
    classIdByName,
  };
}

function buildCreateRequest(
  row: StagedStudentRow,
  gradeIdByName: Map<string, string>,
  academicYearIdByName: Map<string, string>,
  fallbackAcademicYearId: string | null,
): CreateStudentRequest {
  const mapped = row.raw;
  const gradeId = gradeIdByName.get(
    mapped.current_grade!.trim().toLowerCase(),
  )!;
  const statusIsActive = mapped.status?.toUpperCase() === StudentStatus.ACTIVE;

  return {
    full_name: mapped.full_name,
    nick_name: mapped.nick_name,
    email: mapped.email,
    gender: normalizeGender(mapped.gender) as CreateStudentRequest["gender"],
    religion: normalizeReligion(
      mapped.religion,
    ) as CreateStudentRequest["religion"],
    birth_place: mapped.birth_place,
    birth_date: new Date(mapped.birth_date).toISOString(),
    nis: mapped.nis || undefined,
    nisn: mapped.nisn || undefined,
    status: statusIsActive
      ? StudentStatus.REGISTERED
      : (mapped.status?.toUpperCase() as CreateStudentRequest["status"]) ||
        undefined,
    current_grade_id: gradeId,
    join_academic_year_id:
      (mapped.join_academic_year &&
        academicYearIdByName.get(
          mapped.join_academic_year.trim().toLowerCase(),
        )) ||
      fallbackAcademicYearId!,
    join_grade_id: gradeId,
    previous_school: mapped.previous_school || undefined,
    pickup_drop_service: parseBoolean(mapped.pickup_drop_service ?? ""),
    catering_service: parseBoolean(mapped.catering_service ?? ""),
    psb_guide: parseBoolean(mapped.psb_guide ?? ""),
    entry_type: mapped.entry_type
      ?.trim()
      .toUpperCase() as CreateStudentRequest["entry_type"],
  };
}

function buildUpdateRequest(row: StagedStudentRow): UpdateStudentRequest {
  const mapped = row.raw;
  return {
    id: row.matched_student_id!,
    full_name: mapped.full_name || undefined,
    nick_name: mapped.nick_name || undefined,
    email: mapped.email || undefined,
    gender: mapped.gender
      ? (normalizeGender(mapped.gender) as UpdateStudentRequest["gender"])
      : undefined,
    religion: mapped.religion
      ? (normalizeReligion(mapped.religion) as UpdateStudentRequest["religion"])
      : undefined,
    birth_place: mapped.birth_place || undefined,
    birth_date: mapped.birth_date
      ? new Date(mapped.birth_date).toISOString()
      : undefined,
    status:
      (mapped.status?.toUpperCase() as UpdateStudentRequest["status"]) ||
      undefined,
    previous_school: mapped.previous_school || undefined,
    pickup_drop_service: mapped.pickup_drop_service
      ? parseBoolean(mapped.pickup_drop_service)
      : undefined,
    catering_service: mapped.catering_service
      ? parseBoolean(mapped.catering_service)
      : undefined,
    psb_guide: mapped.psb_guide ? parseBoolean(mapped.psb_guide) : undefined,
  };
}

async function captureUpdateSnapshot(
  studentId: string,
  mapped: Record<string, string>,
): Promise<Record<string, string | number | boolean | null> | null> {
  const student = await prismaClient.student.findUnique({
    where: { id: studentId },
    include: { person: true },
  });
  if (!student) return null;

  const snapshot: Record<string, string | number | boolean | null> = {};
  if (mapped.full_name) snapshot.full_name = student.person.full_name;
  if (mapped.nick_name) snapshot.nick_name = student.person.nick_name;
  if (mapped.email) snapshot.email = student.person.email;
  if (mapped.gender) snapshot.gender = student.person.gender;
  if (mapped.religion) snapshot.religion = student.person.religion;
  if (mapped.birth_place) snapshot.birth_place = student.person.birth_place;
  if (mapped.birth_date) {
    snapshot.birth_date = student.person.birth_date.toISOString();
  }
  if (mapped.status) snapshot.status = student.status;
  if (mapped.previous_school) {
    snapshot.previous_school = student.previous_school;
  }
  if (mapped.pickup_drop_service) {
    snapshot.pickup_drop_service = student.pickup_drop_service;
  }
  if (mapped.catering_service) {
    snapshot.catering_service = student.catering_service;
  }
  if (mapped.psb_guide) snapshot.psb_guide = student.psb_guide;

  return snapshot;
}

function buildRevertRequest(row: StagedStudentRow): UpdateStudentRequest {
  const previous = row.previous_values!;
  return {
    id: row.committed_student_id!,
    full_name: previous.full_name as string,
    nick_name: previous.nick_name as string,
    email: previous.email as string,
    gender: previous.gender as UpdateStudentRequest["gender"],
    religion: previous.religion as UpdateStudentRequest["religion"],
    birth_place: previous.birth_place as string,
    birth_date: previous.birth_date as string,
    status: previous.status as UpdateStudentRequest["status"],
    previous_school: (previous.previous_school as string | null) ?? undefined,
    pickup_drop_service: previous.pickup_drop_service as boolean | undefined,
    catering_service: previous.catering_service as boolean | undefined,
    psb_guide: previous.psb_guide as boolean | undefined,
  };
}
type ResolvedEmployeeRows = {
  rows: StagedEmployeeRow[];
  unitIdByName: Map<string, string>;
  jobPositionIdByName: Map<string, string>;
  jobLevelIdByName: Map<string, string>;
  buildingIdByName: Map<string, string>;
};

async function resolveEmployeeStagedRows(
  inputs: MappedRowInput[],
): Promise<ResolvedEmployeeRows> {
  const shapeErrors = new Map<number, string[]>();
  for (const { row_number, mapped } of inputs) {
    shapeErrors.set(
      row_number,
      ImportValidation.validateEmployeeRowShape(mapped),
    );
  }

  const employeeIdValues = [
    ...new Set(inputs.map((r) => r.mapped.employee_id).filter(Boolean)),
  ];
  const emailValues = [
    ...new Set(inputs.map((r) => r.mapped.email).filter(Boolean)),
  ];
  const unitNames = [
    ...new Set(
      inputs.map((r) => r.mapped.unit?.trim().toLowerCase()).filter(Boolean),
    ),
  ] as string[];
  const jobPositionNames = [
    ...new Set(
      inputs
        .map((r) => r.mapped.job_position?.trim().toLowerCase())
        .filter(Boolean),
    ),
  ] as string[];
  const jobLevelNames = [
    ...new Set(
      inputs
        .map((r) => r.mapped.job_level?.trim().toLowerCase())
        .filter(Boolean),
    ),
  ] as string[];
  const buildingNames = [
    ...new Set(
      inputs
        .map((r) => r.mapped.building?.trim().toLowerCase())
        .filter(Boolean),
    ),
  ] as string[];

  const [
    existingEmployees,
    existingPersonsByEmail,
    units,
    jobPositions,
    jobLevels,
    buildings,
  ] = await Promise.all([
    prismaClient.employee.findMany({
      where: { employee_id: { in: employeeIdValues } },
      include: { person: true },
    }),
    prismaClient.person.findMany({
      where: { email: { in: emailValues } },
      include: { employee: true },
    }),
    prismaClient.masterUnit.findMany(),
    prismaClient.masterJobPosition.findMany(),
    prismaClient.masterJobLevel.findMany(),
    prismaClient.masterBuilding.findMany(),
  ]);

  const employeeByEmployeeId = new Map(
    existingEmployees.map((e) => [e.employee_id, e]),
  );
  const personByEmail = new Map(
    existingPersonsByEmail.map((p) => [p.email, p]),
  );
  const unitIdByName = new Map(
    units
      .filter((u) => unitNames.includes(u.name.trim().toLowerCase()))
      .map((u) => [u.name.trim().toLowerCase(), u.id]),
  );
  const jobPositionIdByName = new Map(
    jobPositions
      .filter((p) => jobPositionNames.includes(p.name.trim().toLowerCase()))
      .map((p) => [p.name.trim().toLowerCase(), p.id]),
  );
  const jobLevelIdByName = new Map(
    jobLevels
      .filter((l) => jobLevelNames.includes(l.name.trim().toLowerCase()))
      .map((l) => [l.name.trim().toLowerCase(), l.id]),
  );
  const buildingIdByName = new Map(
    buildings
      .filter((b) => buildingNames.includes(b.name.trim().toLowerCase()))
      .map((b) => [b.name.trim().toLowerCase(), b.id]),
  );

  const employeeIdCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  for (const { mapped } of inputs) {
    if (mapped.employee_id) {
      employeeIdCounts.set(
        mapped.employee_id,
        (employeeIdCounts.get(mapped.employee_id) ?? 0) + 1,
      );
    }
    if (mapped.email) {
      emailCounts.set(mapped.email, (emailCounts.get(mapped.email) ?? 0) + 1);
    }
  }

  const rows: StagedEmployeeRow[] = inputs.map(
    ({ row_number, mapped, source_raw }) => {
      const errors = [...(shapeErrors.get(row_number) ?? [])];
      const warnings: string[] = [];

      if (
        mapped.employee_id &&
        (employeeIdCounts.get(mapped.employee_id) ?? 0) > 1
      ) {
        errors.push(
          `Duplicate Employee ID within the file: ${mapped.employee_id}`,
        );
      }
      if (mapped.email && (emailCounts.get(mapped.email) ?? 0) > 1) {
        errors.push(`Duplicate email within the file: ${mapped.email}`);
      }

      const matchedEmployee = mapped.employee_id
        ? employeeByEmployeeId.get(mapped.employee_id)
        : undefined;
      const action: StagedEmployeeRow["action"] = !mapped.employee_id
        ? null
        : matchedEmployee
          ? "UPDATE"
          : "CREATE";

      if (mapped.email) {
        const emailOwner = personByEmail.get(mapped.email);
        if (emailOwner && emailOwner.id !== matchedEmployee?.person_id) {
          errors.push(
            `Email already registered to another person: ${mapped.email}`,
          );
        }
      }

      if (mapped.unit && !unitIdByName.get(mapped.unit.trim().toLowerCase())) {
        errors.push(`Unit not recognized: ${mapped.unit}`);
      }
      if (
        mapped.job_position &&
        !jobPositionIdByName.get(mapped.job_position.trim().toLowerCase())
      ) {
        errors.push(`Job position not recognized: ${mapped.job_position}`);
      }
      if (
        mapped.job_level &&
        !jobLevelIdByName.get(mapped.job_level.trim().toLowerCase())
      ) {
        errors.push(`Job level not recognized: ${mapped.job_level}`);
      }
      if (
        mapped.building &&
        !buildingIdByName.get(mapped.building.trim().toLowerCase())
      ) {
        errors.push(`Building not recognized: ${mapped.building}`);
      }

      // Only checked once unit/job_level resolved cleanly, to avoid stacking
      // on an already-reported error.
      if (
        mapped.unit &&
        mapped.job_level &&
        unitIdByName.get(mapped.unit.trim().toLowerCase()) &&
        jobLevelIdByName.get(mapped.job_level.trim().toLowerCase())
      ) {
        try {
          assertUnitJobLevelCompatible(mapped.unit, mapped.job_level);
        } catch (error) {
          errors.push(
            error instanceof ResponseError
              ? error.message
              : "Could not validate unit/job level compatibility",
          );
        }
      }

      return {
        row_number,
        raw: mapped,
        source_raw: source_raw ?? mapped,
        action,
        matched_employee_id: matchedEmployee?.id ?? null,
        errors,
        warnings,
        committed_employee_id: null,
        previous_values: null,
      };
    },
  );

  return {
    rows,
    unitIdByName,
    jobPositionIdByName,
    jobLevelIdByName,
    buildingIdByName,
  };
}

function buildEmployeeCreateRequest(
  row: StagedEmployeeRow,
  unitIdByName: Map<string, string>,
  jobPositionIdByName: Map<string, string>,
  jobLevelIdByName: Map<string, string>,
  buildingIdByName: Map<string, string>,
): CreateEmployeeRequest {
  const mapped = row.raw;
  return {
    full_name: mapped.full_name,
    nick_name: mapped.nick_name,
    email: mapped.email,
    gender: normalizeGender(mapped.gender) as CreateEmployeeRequest["gender"],
    religion: normalizeReligion(
      mapped.religion,
    ) as CreateEmployeeRequest["religion"],
    birth_place: mapped.birth_place,
    birth_date: new Date(mapped.birth_date).toISOString(),
    photo_url: mapped.photo_url || undefined,
    employee_id: mapped.employee_id,
    status:
      (mapped.status?.toUpperCase() as CreateEmployeeRequest["status"]) ||
      "ACTIVE",
    employment_type:
      mapped.employment_type.toUpperCase() as CreateEmployeeRequest["employment_type"],
    unit_id: unitIdByName.get(mapped.unit.trim().toLowerCase())!,
    job_position_id: jobPositionIdByName.get(
      mapped.job_position.trim().toLowerCase(),
    )!,
    job_level_id: jobLevelIdByName.get(mapped.job_level.trim().toLowerCase())!,
    building_id: buildingIdByName.get(mapped.building.trim().toLowerCase())!,
    join_date: new Date(mapped.join_date).toISOString(),
    resignation_date: mapped.resignation_date
      ? new Date(mapped.resignation_date).toISOString()
      : undefined,
    last_working_date: mapped.last_working_date
      ? new Date(mapped.last_working_date).toISOString()
      : undefined,
    notes: mapped.notes || undefined,
    marital_status:
      mapped.marital_status.toUpperCase() as CreateEmployeeRequest["marital_status"],
    mobile_phone: mapped.mobile_phone || undefined,
    residential_address: mapped.residential_address || undefined,
    nik: mapped.nik || undefined,
    npwp: mapped.npwp || undefined,
    bank_account_number: mapped.bank_account_number || undefined,
    bpjs_number: mapped.bpjs_number || undefined,
  };
}

function buildEmployeeUpdateRequest(
  row: StagedEmployeeRow,
): UpdateEmployeeRequest {
  const mapped = row.raw;
  return {
    id: row.matched_employee_id!,
    full_name: mapped.full_name || undefined,
    nick_name: mapped.nick_name || undefined,
    email: mapped.email || undefined,
    gender: mapped.gender
      ? (normalizeGender(mapped.gender) as UpdateEmployeeRequest["gender"])
      : undefined,
    religion: mapped.religion
      ? (normalizeReligion(
          mapped.religion,
        ) as UpdateEmployeeRequest["religion"])
      : undefined,
    birth_place: mapped.birth_place || undefined,
    birth_date: mapped.birth_date
      ? new Date(mapped.birth_date).toISOString()
      : undefined,
    status:
      (mapped.status?.toUpperCase() as UpdateEmployeeRequest["status"]) ||
      undefined,
    employment_type:
      (mapped.employment_type?.toUpperCase() as UpdateEmployeeRequest["employment_type"]) ||
      undefined,
    join_date: mapped.join_date
      ? new Date(mapped.join_date).toISOString()
      : undefined,
    resignation_date: mapped.resignation_date
      ? new Date(mapped.resignation_date).toISOString()
      : undefined,
    last_working_date: mapped.last_working_date
      ? new Date(mapped.last_working_date).toISOString()
      : undefined,
    notes: mapped.notes || undefined,
    marital_status:
      (mapped.marital_status?.toUpperCase() as UpdateEmployeeRequest["marital_status"]) ||
      undefined,
    mobile_phone: mapped.mobile_phone || undefined,
    residential_address: mapped.residential_address || undefined,
    nik: mapped.nik || undefined,
    npwp: mapped.npwp || undefined,
    bank_account_number: mapped.bank_account_number || undefined,
    bpjs_number: mapped.bpjs_number || undefined,
  };
}

async function captureEmployeeUpdateSnapshot(
  employeeId: string,
  mapped: Record<string, string>,
): Promise<Record<string, string | number | boolean | null> | null> {
  const employee = await prismaClient.employee.findUnique({
    where: { id: employeeId },
    include: { person: true },
  });
  if (!employee) return null;

  const snapshot: Record<string, string | number | boolean | null> = {};
  if (mapped.full_name) snapshot.full_name = employee.person.full_name;
  if (mapped.nick_name) snapshot.nick_name = employee.person.nick_name;
  if (mapped.email) snapshot.email = employee.person.email;
  if (mapped.gender) snapshot.gender = employee.person.gender;
  if (mapped.religion) snapshot.religion = employee.person.religion;
  if (mapped.birth_place) snapshot.birth_place = employee.person.birth_place;
  if (mapped.birth_date) {
    snapshot.birth_date = employee.person.birth_date.toISOString();
  }
  if (mapped.status) snapshot.status = employee.status;
  if (mapped.employment_type) {
    snapshot.employment_type = employee.employment_type;
  }
  if (mapped.join_date) snapshot.join_date = employee.join_date.toISOString();
  if (mapped.resignation_date) {
    snapshot.resignation_date = employee.resignation_date
      ? employee.resignation_date.toISOString()
      : null;
  }
  if (mapped.last_working_date) {
    snapshot.last_working_date = employee.last_working_date
      ? employee.last_working_date.toISOString()
      : null;
  }
  if (mapped.notes) snapshot.notes = employee.notes;
  if (mapped.marital_status) snapshot.marital_status = employee.marital_status;
  if (mapped.mobile_phone) snapshot.mobile_phone = employee.mobile_phone;
  if (mapped.residential_address) {
    snapshot.residential_address = employee.residential_address;
  }
  if (mapped.nik) snapshot.nik = employee.nik;
  if (mapped.npwp) snapshot.npwp = employee.npwp;
  if (mapped.bank_account_number) {
    snapshot.bank_account_number = employee.bank_account_number;
  }
  if (mapped.bpjs_number) snapshot.bpjs_number = employee.bpjs_number;

  return snapshot;
}

function buildEmployeeRevertRequest(
  row: StagedEmployeeRow,
): UpdateEmployeeRequest {
  const previous = row.previous_values!;
  return {
    id: row.committed_employee_id!,
    full_name: previous.full_name as string | undefined,
    nick_name: previous.nick_name as string | undefined,
    email: previous.email as string | undefined,
    gender: previous.gender as UpdateEmployeeRequest["gender"],
    religion: previous.religion as UpdateEmployeeRequest["religion"],
    birth_place: previous.birth_place as string | undefined,
    birth_date: previous.birth_date as string | undefined,
    status: previous.status as UpdateEmployeeRequest["status"],
    employment_type:
      previous.employment_type as UpdateEmployeeRequest["employment_type"],
    join_date: previous.join_date as string | undefined,
    resignation_date: (previous.resignation_date as string | null) ?? undefined,
    last_working_date:
      (previous.last_working_date as string | null) ?? undefined,
    notes: (previous.notes as string | null) ?? undefined,
    marital_status:
      previous.marital_status as UpdateEmployeeRequest["marital_status"],
    mobile_phone: (previous.mobile_phone as string | null) ?? undefined,
    residential_address:
      (previous.residential_address as string | null) ?? undefined,
    nik: (previous.nik as string | null) ?? undefined,
    npwp: (previous.npwp as string | null) ?? undefined,
    bank_account_number:
      (previous.bank_account_number as string | null) ?? undefined,
    bpjs_number: (previous.bpjs_number as string | null) ?? undefined,
  };
}

export class ImportService {
  static async previewStudents(
    admin: AdminUser,
    file: File,
    mapping: Partial<Record<string, ImportStudentFieldKey>> | undefined,
    sheet: SheetSelector | undefined,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PreviewStudentImportResponse> {
    await assertSuperAdminImport(admin, "preview", context);

    const {
      headers,
      rows: rawRows,
      sheet_name,
      other_sheets,
    } = await parseImportFile(file, sheet);
    const { mapping: resolvedMapping, unmappedHeaders } =
      ImportValidation.resolveFieldMapping(headers, mapping);

    const inputs: MappedRowInput[] = rawRows.map((values, index) => ({
      row_number: index + 2,
      mapped: ImportValidation.mapRow(headers, values, resolvedMapping),
      source_raw: buildSourceRaw(headers, values),
    }));

    const { rows } = await resolveStagedRows(inputs);
    const summary = summarize(rows);

    const job = await prismaClient.importJob.create({
      data: {
        type: ImportType.STUDENT,
        status: ImportStatus.PENDING,
        file_name: file.name,
        total_rows: summary.total_rows,
        valid_rows: summary.valid_rows,
        error_rows: summary.error_rows,
        field_mapping: resolvedMapping,
        staged_rows: rows,
        result_summary: summary,
        created_by: admin.id,
      },
    });

    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Student",
        phase: "preview",
        job_id: job.id,
        file_name: file.name,
        sheet_name,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status: job.status,
      type: job.type,
      field_mapping: resolvedMapping as Record<string, ImportStudentFieldKey>,
      unmapped_headers: unmappedHeaders,
      summary,
      rows,
      sheet_name,
      source_headers: headers,
      other_sheets,
    };
  }

  static async commitStudents(
    admin: AdminUser,
    jobId: string,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<CommitStudentImportResponse> {
    await assertSuperAdminImport(admin, "commit", context);

    const job = await prismaClient.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.type !== ImportType.STUDENT) {
      throw new ResponseError(404, "Import job not found");
    }
    if (job.status !== ImportStatus.PENDING) {
      throw new ResponseError(
        400,
        `Import job already ${job.status.toLowerCase()} - it can only be committed once`,
      );
    }

    const stagedRows = (job.staged_rows as StagedStudentRow[] | null) ?? [];
    const inputs: MappedRowInput[] = stagedRows.map((row) => ({
      row_number: row.row_number,
      mapped: row.raw,
      source_raw: row.source_raw,
    }));

    const {
      rows,
      gradeIdByName,
      academicYearIdByName,
      fallbackAcademicYearId,
      classIdByName,
    } = await resolveStagedRows(inputs);

    for (const row of rows) {
      if (row.errors.length > 0 || row.action === null) continue;

      try {
        if (row.action === "CREATE") {
          const created = await StudentService.create(
            admin,
            buildCreateRequest(
              row,
              gradeIdByName,
              academicYearIdByName,
              fallbackAcademicYearId,
            ),
            context,
            now,
          );
          row.committed_student_id = created.id;

          for (const parent of row.parents) {
            await tryCreateRelation(
              parent,
              row.errors,
              `Parent/guardian (${parent.type})`,
              () =>
                ParentGuardianService.create(
                  admin,
                  {
                    student_id: created.id,
                    type: parent.type as ParentType,
                    full_name: parent.full_name,
                    phone: parent.phone ?? undefined,
                    email: parent.email ?? undefined,
                    address: parent.address ?? undefined,
                  },
                  context,
                  now,
                ),
            );
          }

          if (row.health) {
            await tryCreateRelation(
              row.health,
              row.errors,
              "Health record",
              () =>
                HealthRecordService.create(
                  admin,
                  {
                    student_id: created.id,
                    blood_type: row.health!.blood_type ?? undefined,
                    needs_assistance: row.health!.needs_assistance,
                  },
                  context,
                  now,
                ),
            );
          }

          for (const note of row.health_notes) {
            await tryCreateRelation(
              note,
              row.errors,
              `Health note (${note.category})`,
              () =>
                HealthNoteService.create(
                  admin,
                  {
                    student_id: created.id,
                    category: note.category as HealthNoteCategory,
                    description: note.description,
                  },
                  context,
                  now,
                ),
            );
          }

          for (const consent of row.consents) {
            await tryCreateRelation(
              consent,
              row.errors,
              `Consent (${consent.consent_type})`,
              () =>
                ConsentService.create(
                  admin,
                  {
                    student_id: created.id,
                    consent_type: consent.consent_type as ConsentType,
                    status: consent.status as ConsentStatus,
                    signed_by: consent.signed_by ?? undefined,
                  },
                  context,
                  now,
                ),
            );
          }

          for (const activity of row.pc_activities) {
            await tryCreateRelation(
              activity,
              row.errors,
              `PC activity (${activity.day})`,
              () =>
                PCActivityService.create(
                  admin,
                  {
                    student_id: created.id,
                    day: activity.day as PCDay,
                    activity: activity.activity,
                  },
                  context,
                  now,
                ),
            );
          }

          for (const vaccine of row.vaccine_records) {
            await tryCreateRelation(
              vaccine,
              row.errors,
              `Vaccine record (${vaccine.vaccine_type})`,
              () =>
                VaccineRecordService.create(
                  admin,
                  {
                    student_id: created.id,
                    vaccine_type: vaccine.vaccine_type as VaccineType,
                    received: vaccine.received,
                    date: vaccine.date
                      ? new Date(vaccine.date).toISOString()
                      : undefined,
                  },
                  context,
                  now,
                ),
            );
          }

          if (row.enrollment) {
            await tryCreateRelation(
              row.enrollment,
              row.errors,
              `Class enrollment (${row.enrollment.class_name})`,
              async () => {
                const classId = classIdByName.get(
                  row.enrollment!.class_name.trim().toLowerCase(),
                );
                if (!classId) {
                  throw new ResponseError(
                    400,
                    `Class not recognized: ${row.enrollment!.class_name}`,
                  );
                }
                const enrollmentResult = await EnrollmentService.create(
                  admin,
                  {
                    student_id: created.id,
                    class_id: classId,
                    start_date: row.enrollment!.start_date
                      ? new Date(row.enrollment!.start_date).toISOString()
                      : undefined,
                  },
                  context,
                  now,
                );

                // Re-importing historical data (e.g. an already-graduated
                // student) - close the freshly created enrollment right away
                // instead of leaving it ACTIVE, mirroring the auto-close
                // StudentService.update() does on a live status change.
                const importedStatus = row.raw.status?.trim().toUpperCase() as
                  | StudentStatus
                  | undefined;
                const closingStatus = importedStatus
                  ? TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS[
                      importedStatus
                    ]
                  : undefined;
                if (closingStatus) {
                  const endDate = row.enrollment!.end_date
                    ? new Date(row.enrollment!.end_date)
                    : now;
                  await prismaClient.studentClassEnrollment.update({
                    where: { id: enrollmentResult.id },
                    data: { enrollment_status: closingStatus, end_date: endDate },
                  });
                  await prismaClient.student.update({
                    where: { id: created.id },
                    data: { current_class_id: null },
                  });
                  await AuditService.record({
                    action: AuditAction.WITHDRAW_STUDENT_ENROLLMENT,
                    source: AuditSource.UI,
                    entity_type: "StudentClassEnrollment",
                    entity_id: enrollmentResult.id,
                    admin_id: admin.id,
                    old_values: { enrollment_status: "ACTIVE" },
                    new_values: {
                      enrollment_status: closingStatus,
                      end_date: endDate.toISOString(),
                    },
                    ip_address: context.ip_address,
                    user_agent: context.user_agent,
                  });
                }

                return enrollmentResult;
              },
            );
          }
        } else {
          row.previous_values = await captureUpdateSnapshot(
            row.matched_student_id!,
            row.raw,
          );
          await StudentService.update(
            admin,
            buildUpdateRequest(row),
            context,
            now,
          );
          row.committed_student_id = row.matched_student_id;
        }
      } catch (error) {
        row.errors.push(describeCommitError(error));
      }
    }

    const summary = summarize(rows);
    const status =
      summary.error_rows === 0
        ? ImportStatus.COMPLETED
        : summary.valid_rows === 0
          ? ImportStatus.FAILED
          : ImportStatus.PARTIAL;

    await prismaClient.importJob.update({
      where: { id: job.id },
      data: {
        status,
        valid_rows: summary.valid_rows,
        error_rows: summary.error_rows,
        staged_rows: rows,
        result_summary: summary,
        completed_at: now,
      },
    });

    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Student",
        phase: "commit",
        job_id: job.id,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return { job_id: job.id, status, summary, rows };
  }

  static async rollbackStudents(
    admin: AdminUser,
    jobId: string,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<RollbackStudentImportResponse> {
    await assertSuperAdminImport(admin, "rollback", context);

    const job = await prismaClient.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.type !== ImportType.STUDENT) {
      throw new ResponseError(404, "Import job not found");
    }
    if (
      job.status !== ImportStatus.COMPLETED &&
      job.status !== ImportStatus.PARTIAL
    ) {
      throw new ResponseError(
        400,
        `Import job is ${job.status.toLowerCase()} - only a COMPLETED or PARTIAL job can be rolled back`,
      );
    }

    const rows = (job.staged_rows as StagedStudentRow[] | null) ?? [];
    let revertedCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      if (!row.committed_student_id) continue;

      try {
        if (row.action === "CREATE") {
          const studentId = row.committed_student_id;

          for (const parent of row.parents) {
            await tryRemoveRelation(
              parent,
              row.errors,
              `Parent/guardian (${parent.type})`,
              () =>
                ParentGuardianService.remove(
                  admin,
                  { id: parent.committed_id!, student_id: studentId },
                  context,
                ),
            );
          }
          if (row.health) {
            await tryRemoveRelation(
              row.health,
              row.errors,
              "Health record",
              () =>
                HealthRecordService.remove(
                  admin,
                  { student_id: studentId },
                  context,
                ),
            );
          }
          for (const note of row.health_notes) {
            await tryRemoveRelation(
              note,
              row.errors,
              `Health note (${note.category})`,
              () =>
                HealthNoteService.remove(
                  admin,
                  { id: note.committed_id!, student_id: studentId },
                  context,
                ),
            );
          }
          for (const consent of row.consents) {
            await tryRemoveRelation(
              consent,
              row.errors,
              `Consent (${consent.consent_type})`,
              () =>
                ConsentService.remove(
                  admin,
                  { id: consent.committed_id!, student_id: studentId },
                  context,
                ),
            );
          }
          for (const activity of row.pc_activities) {
            await tryRemoveRelation(
              activity,
              row.errors,
              `PC activity (${activity.day})`,
              () =>
                PCActivityService.remove(
                  admin,
                  { id: activity.committed_id!, student_id: studentId },
                  context,
                ),
            );
          }
          for (const vaccine of row.vaccine_records) {
            await tryRemoveRelation(
              vaccine,
              row.errors,
              `Vaccine record (${vaccine.vaccine_type})`,
              () =>
                VaccineRecordService.remove(
                  admin,
                  { id: vaccine.committed_id!, student_id: studentId },
                  context,
                ),
            );
          }
          if (row.enrollment) {
            await tryRemoveRelation(
              row.enrollment,
              row.errors,
              `Class enrollment (${row.enrollment.class_name})`,
              () =>
                EnrollmentService.remove(
                  admin,
                  { id: row.enrollment!.committed_id!, student_id: studentId },
                  context,
                ),
            );
          }

          await StudentService.remove(admin, { id: studentId }, context);
        } else if (row.action === "UPDATE" && row.previous_values) {
          await StudentService.update(
            admin,
            buildRevertRequest(row),
            context,
            now,
          );
        }
        row.committed_student_id = null;
        revertedCount++;
      } catch (error) {
        row.errors.push(`Rollback failed: ${describeCommitError(error)}`);
        failedCount++;
      }
    }

    const summary: RollbackSummary = {
      reverted_count: revertedCount,
      failed_count: failedCount,
    };

    await prismaClient.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportStatus.ROLLED_BACK,
        staged_rows: rows,
        result_summary: {
          ...(job.result_summary as Record<string, unknown> | null),
          rollback: summary,
        },
      },
    });

    await AuditService.record({
      action: AuditAction.ROLLBACK_IMPORT,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Student",
        job_id: job.id,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status: ImportStatus.ROLLED_BACK,
      summary,
      rows,
    };
  }

  static async getJob(id: string): Promise<ImportJobResponse> {
    const job = await prismaClient.importJob.findUnique({ where: { id } });
    if (!job || job.type !== ImportType.STUDENT) {
      throw new ResponseError(404, "Import job not found");
    }
    return toImportJobResponse(job);
  }

  static async previewEmployees(
    admin: AdminUser,
    file: File,
    mapping: Partial<Record<string, ImportEmployeeFieldKey>> | undefined,
    sheet: SheetSelector | undefined,
    context: AuditRequestContext = {},
  ): Promise<PreviewEmployeeImportResponse> {
    await assertSuperAdminImport(admin, "preview", context);

    const {
      headers,
      rows: rawRows,
      sheet_name,
      other_sheets,
    } = await parseImportFile(file, sheet);
    const { mapping: resolvedMapping, unmappedHeaders } =
      ImportValidation.resolveEmployeeFieldMapping(headers, mapping);

    const inputs: MappedRowInput[] = rawRows.map((values, index) => ({
      row_number: index + 2,
      mapped: ImportValidation.mapEmployeeRow(headers, values, resolvedMapping),
      source_raw: buildSourceRaw(headers, values),
    }));

    const { rows } = await resolveEmployeeStagedRows(inputs);
    const summary = summarize(rows);

    const job = await prismaClient.importJob.create({
      data: {
        type: ImportType.EMPLOYEE,
        status: ImportStatus.PENDING,
        file_name: file.name,
        total_rows: summary.total_rows,
        valid_rows: summary.valid_rows,
        error_rows: summary.error_rows,
        field_mapping: resolvedMapping,
        staged_rows: rows,
        result_summary: summary,
        created_by: admin.id,
      },
    });

    // Same as previewStudents - response echoes sensitive fields
    // (NIK/NPWP/bank/BPJS), audited like any other read of that data.
    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Employee",
        phase: "preview",
        job_id: job.id,
        file_name: file.name,
        sheet_name,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status: job.status,
      type: job.type,
      field_mapping: resolvedMapping as Record<string, ImportEmployeeFieldKey>,
      unmapped_headers: unmappedHeaders,
      summary,
      rows,
      sheet_name,
      source_headers: headers,
      other_sheets,
    };
  }

  static async commitEmployees(
    admin: AdminUser,
    jobId: string,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<CommitEmployeeImportResponse> {
    await assertSuperAdminImport(admin, "commit", context);

    const job = await prismaClient.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.type !== ImportType.EMPLOYEE) {
      throw new ResponseError(404, "Import job not found");
    }
    if (job.status !== ImportStatus.PENDING) {
      throw new ResponseError(
        400,
        `Import job already ${job.status.toLowerCase()} - it can only be committed once`,
      );
    }

    const stagedRows = (job.staged_rows as StagedEmployeeRow[] | null) ?? [];
    const inputs: MappedRowInput[] = stagedRows.map((row) => ({
      row_number: row.row_number,
      mapped: row.raw,
      source_raw: row.source_raw,
    }));

    const {
      rows,
      unitIdByName,
      jobPositionIdByName,
      jobLevelIdByName,
      buildingIdByName,
    } = await resolveEmployeeStagedRows(inputs);

    for (const row of rows) {
      if (row.errors.length > 0 || row.action === null) continue;

      try {
        if (row.action === "CREATE") {
          const created = await EmployeeService.create(
            admin,
            buildEmployeeCreateRequest(
              row,
              unitIdByName,
              jobPositionIdByName,
              jobLevelIdByName,
              buildingIdByName,
            ),
            context,
            now,
          );
          row.committed_employee_id = created.id;
        } else {
          row.previous_values = await captureEmployeeUpdateSnapshot(
            row.matched_employee_id!,
            row.raw,
          );
          await EmployeeService.update(
            admin,
            buildEmployeeUpdateRequest(row),
            context,
            now,
          );
          row.committed_employee_id = row.matched_employee_id;
        }
      } catch (error) {
        row.errors.push(describeCommitError(error));
      }
    }

    const summary = summarize(rows);
    const status =
      summary.error_rows === 0
        ? ImportStatus.COMPLETED
        : summary.valid_rows === 0
          ? ImportStatus.FAILED
          : ImportStatus.PARTIAL;

    await prismaClient.importJob.update({
      where: { id: job.id },
      data: {
        status,
        valid_rows: summary.valid_rows,
        error_rows: summary.error_rows,
        staged_rows: rows,
        result_summary: summary,
        completed_at: now,
      },
    });

    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Employee",
        phase: "commit",
        job_id: job.id,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return { job_id: job.id, status, summary, rows };
  }

  // Same tier as rollbackStudents - EmployeeService.remove() is already
  // SUPER_ADMIN-only, so this doesn't grant anything new.
  static async rollbackEmployees(
    admin: AdminUser,
    jobId: string,
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<RollbackEmployeeImportResponse> {
    await assertSuperAdminImport(admin, "rollback", context);

    const job = await prismaClient.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.type !== ImportType.EMPLOYEE) {
      throw new ResponseError(404, "Import job not found");
    }
    if (
      job.status !== ImportStatus.COMPLETED &&
      job.status !== ImportStatus.PARTIAL
    ) {
      throw new ResponseError(
        400,
        `Import job is ${job.status.toLowerCase()} - only a COMPLETED or PARTIAL job can be rolled back`,
      );
    }

    const rows = (job.staged_rows as StagedEmployeeRow[] | null) ?? [];
    let revertedCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      if (!row.committed_employee_id) continue;

      try {
        if (row.action === "CREATE") {
          await EmployeeService.remove(
            admin,
            { id: row.committed_employee_id },
            context,
          );
        } else if (row.action === "UPDATE" && row.previous_values) {
          await EmployeeService.update(
            admin,
            buildEmployeeRevertRequest(row),
            context,
            now,
          );
        }
        row.committed_employee_id = null;
        revertedCount++;
      } catch (error) {
        row.errors.push(`Rollback failed: ${describeCommitError(error)}`);
        failedCount++;
      }
    }

    const summary: RollbackSummary = {
      reverted_count: revertedCount,
      failed_count: failedCount,
    };

    await prismaClient.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportStatus.ROLLED_BACK,
        staged_rows: rows,
        result_summary: {
          ...(job.result_summary as Record<string, unknown> | null),
          rollback: summary,
        },
      },
    });

    await AuditService.record({
      action: AuditAction.ROLLBACK_IMPORT,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Employee",
        job_id: job.id,
        ...summary,
      },
      ip_address: context.ip_address,
      user_agent: context.user_agent,
    });

    return {
      job_id: job.id,
      status: ImportStatus.ROLLED_BACK,
      summary,
      rows,
    };
  }

  static async getEmployeeJob(id: string): Promise<EmployeeImportJobResponse> {
    const job = await prismaClient.importJob.findUnique({ where: { id } });
    if (!job || job.type !== ImportType.EMPLOYEE) {
      throw new ResponseError(404, "Import job not found");
    }
    return toEmployeeImportJobResponse(job);
  }

  static async cleanupJobs(
    admin: AdminUser,
    olderThanDays: number,
    context: AuditRequestContext = {},
  ): Promise<{ deleted_count: number }> {
    await assertSuperAdminImport(admin, "cleanup", context);

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await prismaClient.importJob.deleteMany({
      where: { status: ImportStatus.PENDING, created_at: { lt: cutoff } },
    });

    return { deleted_count: result.count };
  }
}
