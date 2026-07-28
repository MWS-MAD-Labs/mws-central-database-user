import {
  AcademicYearStatus,
  AdminRole,
  AuditAction,
  AuditSource,
  ImportStatus,
  ImportType,
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
} from "../generated/prisma/client";
import { AuditService } from "./audit-service";
import { StudentService } from "./student-service";
import { EmployeeService } from "./employee-service";
import { ParentGuardianService } from "./parent-guardian-service";
import { HealthRecordService } from "./health-record-service";
import { HealthNoteService } from "./health-note-service";
import { ConsentService } from "./consent-service";
import { PCActivityService } from "./pc-activity-service";
import { parseImportFile } from "../utils/import-file";
import { ImportValidation } from "../validation/import-validation";

type MappedRowInput = { row_number: number; mapped: Record<string, string> };

type ResolvedRows = {
  rows: StagedStudentRow[];
  gradeIdByName: Map<string, string>;
  academicYearIdByName: Map<string, string>;
  fallbackAcademicYearId: string | null;
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
// SUPER_ADMIN-only for every step, preview included - preview's response
// echoes back raw staged data (birth dates, parent contacts, health info,
// and eventually employee NIK/NPWP/bank details) verbatim. A DATABASE_ADMIN
// who isn't the one who prepared the file could otherwise see all of it
// just by being asked to "run the file through the tool" for someone else.
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
  "parents" | "health" | "health_notes" | "consents" | "pc_activities"
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

  return { parents, health, health_notes, consents, pc_activities };
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

  const [existingStudents, existingPersonsByEmail, grades, years, activeYear] =
    await Promise.all([
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
  const academicYearIdByName = new Map(
    years
      .filter((y) => yearNames.includes(y.name.trim().toLowerCase()))
      .map((y) => [y.name.trim().toLowerCase(), y.id]),
  );
  const nisCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  for (const { mapped } of inputs) {
    if (mapped.nis)
      nisCounts.set(mapped.nis, (nisCounts.get(mapped.nis) ?? 0) + 1);
    if (mapped.email)
      emailCounts.set(mapped.email, (emailCounts.get(mapped.email) ?? 0) + 1);
  }

  const rows: StagedStudentRow[] = inputs.map(({ row_number, mapped }) => {
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
    const action: StagedStudentRow["action"] = !mapped.nis
      ? null
      : matchedStudent
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

    if (
      action === "CREATE" &&
      mapped.status &&
      mapped.status.toUpperCase() === StudentStatus.ACTIVE
    ) {
      warnings.push(
        "Status ACTIVE ignored for a new student - created as REGISTERED. Activate after assigning a class.",
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
          };

    return {
      row_number,
      raw: mapped,
      action,
      matched_student_id: matchedStudent?.id ?? null,
      errors,
      warnings,
      committed_student_id: null,
      previous_values: null,
      ...relationSubRows,
    };
  });

  return {
    rows,
    gradeIdByName,
    academicYearIdByName,
    fallbackAcademicYearId: activeYear?.id ?? null,
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
    gender: mapped.gender.toUpperCase() as CreateStudentRequest["gender"],
    religion: mapped.religion.toUpperCase() as CreateStudentRequest["religion"],
    birth_place: mapped.birth_place,
    birth_date: new Date(mapped.birth_date).toISOString(),
    nis: mapped.nis,
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
  };
}

function buildUpdateRequest(row: StagedStudentRow): UpdateStudentRequest {
  const mapped = row.raw;
  return {
    id: row.matched_student_id!,
    full_name: mapped.full_name || undefined,
    nick_name: mapped.nick_name || undefined,
    email: mapped.email || undefined,
    gender:
      (mapped.gender?.toUpperCase() as UpdateStudentRequest["gender"]) ||
      undefined,
    religion:
      (mapped.religion?.toUpperCase() as UpdateStudentRequest["religion"]) ||
      undefined,
    birth_place: mapped.birth_place || undefined,
    birth_date: mapped.birth_date
      ? new Date(mapped.birth_date).toISOString()
      : undefined,
    status:
      (mapped.status?.toUpperCase() as UpdateStudentRequest["status"]) ||
      undefined,
    previous_school: mapped.previous_school || undefined,
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
  };
}
type ResolvedEmployeeRows = {
  rows: StagedEmployeeRow[];
  unitIdByName: Map<string, string>;
  jobPositionIdByName: Map<string, string>;
  jobLevelIdByName: Map<string, string>;
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

  const [
    existingEmployees,
    existingPersonsByEmail,
    units,
    jobPositions,
    jobLevels,
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

  const rows: StagedEmployeeRow[] = inputs.map(({ row_number, mapped }) => {
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

    return {
      row_number,
      raw: mapped,
      action,
      matched_employee_id: matchedEmployee?.id ?? null,
      errors,
      warnings,
      committed_employee_id: null,
      previous_values: null,
    };
  });

  return { rows, unitIdByName, jobPositionIdByName, jobLevelIdByName };
}

function buildEmployeeCreateRequest(
  row: StagedEmployeeRow,
  unitIdByName: Map<string, string>,
  jobPositionIdByName: Map<string, string>,
  jobLevelIdByName: Map<string, string>,
): CreateEmployeeRequest {
  const mapped = row.raw;
  return {
    full_name: mapped.full_name,
    nick_name: mapped.nick_name,
    email: mapped.email,
    gender: mapped.gender.toUpperCase() as CreateEmployeeRequest["gender"],
    religion:
      mapped.religion.toUpperCase() as CreateEmployeeRequest["religion"],
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
    building: mapped.building,
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
    gender:
      (mapped.gender?.toUpperCase() as UpdateEmployeeRequest["gender"]) ||
      undefined,
    religion:
      (mapped.religion?.toUpperCase() as UpdateEmployeeRequest["religion"]) ||
      undefined,
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
    building: mapped.building || undefined,
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
  if (mapped.building) snapshot.building = employee.building;
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
    building: previous.building as string | undefined,
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
    context: AuditRequestContext = {},
    now: Date = new Date(),
  ): Promise<PreviewStudentImportResponse> {
    await assertSuperAdminImport(admin, "preview", context);

    const { headers, rows: rawRows } = await parseImportFile(file);
    const { mapping: resolvedMapping, unmappedHeaders } =
      ImportValidation.resolveFieldMapping(headers, mapping);

    const inputs: MappedRowInput[] = rawRows.map((values, index) => ({
      row_number: index + 2,
      mapped: ImportValidation.mapRow(headers, values, resolvedMapping),
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

    // Preview's response echoes back every staged field verbatim, including
    // sensitive ones (birth dates, parent contacts, health info) - same
    // class of access as ACCESS_HEALTH_DATA on a single-student read, just
    // for up to `total_rows` people at once, so it gets the same audit
    // treatment rather than only auditing the eventual commit.
    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Student",
        phase: "preview",
        job_id: job.id,
        file_name: file.name,
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
    }));

    const {
      rows,
      gradeIdByName,
      academicYearIdByName,
      fallbackAcademicYearId,
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
    context: AuditRequestContext = {},
  ): Promise<PreviewEmployeeImportResponse> {
    await assertSuperAdminImport(admin, "preview", context);

    const { headers, rows: rawRows } = await parseImportFile(file);
    const { mapping: resolvedMapping, unmappedHeaders } =
      ImportValidation.resolveEmployeeFieldMapping(headers, mapping);

    const inputs: MappedRowInput[] = rawRows.map((values, index) => ({
      row_number: index + 2,
      mapped: ImportValidation.mapEmployeeRow(headers, values, resolvedMapping),
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

    // Same reasoning as previewStudents - the response echoes back every
    // staged field, including the sensitive tier (NIK/NPWP/bank/BPJS), so
    // it's audited the same way a read of that data elsewhere is.
    await AuditService.record({
      action: AuditAction.IMPORT_DATA,
      source: AuditSource.UI,
      admin_id: admin.id,
      new_values: {
        entity: "Employee",
        phase: "preview",
        job_id: job.id,
        file_name: file.name,
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
    }));

    const { rows, unitIdByName, jobPositionIdByName, jobLevelIdByName } =
      await resolveEmployeeStagedRows(inputs);

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
