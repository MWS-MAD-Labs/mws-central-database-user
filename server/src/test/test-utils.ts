import { web } from "../application/web";
import { sign } from "hono/jwt";
import { randomBytes, createHash } from "crypto";
import {
  AcademicYearStatus,
  AdminRole,
  BloodType,
  ClassStatus,
  ClassTeacherRole,
  ConsentStatus,
  ConsentType,
  EmployeeStatus,
  EmploymentType,
  EnrollmentStatus,
  Gender,
  HealthNoteCategory,
  HealthNoteStatus,
  InternStatus,
  MaritalStatus,
  ParentType,
  PCDay,
  PersonType,
  Religion,
  StudentEntryType,
  StudentStatus,
  VaccineType,
} from "../generated/prisma/enums";
import { prismaClient } from "../lib/prisma";
import { generateApiToken } from "../utils/generate-api-token";
import { minioClient, MINIO_BUCKET } from "../lib/minio";

const JWT_SECRET = process.env.JWT_SECRET || "secret";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function generateTestTokens(
  adminId: string,
  email: string,
  role: AdminRole,
) {
  const payload = {
    id: adminId,
    email: email,
    role: role,
    exp: Math.floor(Date.now() / 1000) + 60 * 15,
  };

  const accessToken = await sign(payload, JWT_SECRET, "HS256");
  const refreshToken = randomBytes(32).toString("hex");

  return { accessToken, refreshToken };
}

async function generateEmployeeAccessToken(employeeId: string, email: string) {
  const payload = {
    id: employeeId,
    email: email,
    type: "employee" as const,
    exp: Math.floor(Date.now() / 1000) + 60 * 15,
  };

  return sign(payload, JWT_SECRET, "HS256");
}

export class AdminUserTest {
  static async resolveUnitId(unitId?: string): Promise<string> {
    if (unitId) return unitId;

    const defaultUnit = await prismaClient.masterUnit.findFirst({
      where: { name: { startsWith: "TEST_" } },
      orderBy: { created_at: "desc" },
    });
    if (!defaultUnit) {
      throw new Error(
        "No MasterUnit found in database. Did you forget to run MasterDataTest.create()?",
      );
    }
    return defaultUnit.id;
  }

  static async delete() {
    await prismaClient.adminUser.deleteMany({
      where: {
        email: {
          contains: "@millennia21.id",
          // Preserve the configured local development admin.
          ...(process.env.DEV_ADMIN_EMAIL
            ? { not: process.env.DEV_ADMIN_EMAIL }
            : {}),
        },
      },
    });
  }

  static async createSuperAdmin(
    unitId?: string,
    options: { id?: string; email?: string } = {},
  ): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const adminId = options.id ?? "test-super-admin-id";
    const email = options.email ?? "test_superadmin@millennia21.id";
    const resolvedUnitId = await this.resolveUnitId(unitId);

    const { accessToken, refreshToken } = await generateTestTokens(
      adminId,
      email,
      AdminRole.SUPER_ADMIN,
    );

    await prismaClient.adminUser.create({
      data: {
        id: adminId,
        email: email,
        full_name: "Test Super Admin",
        role: AdminRole.SUPER_ADMIN,
        unit_id: resolvedUnitId,
        is_active: true,
        refresh_token_hash: hashToken(refreshToken),
        refresh_token_exp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  static async createDatabaseAdmin(
    unitId?: string,
    options?: {
      canViewSensitiveData?: boolean;
      canViewAllUnits?: boolean;
      canViewEmployeePii?: boolean;
      // Write permissions default on for existing test fixtures.
      canWriteEmployeeData?: boolean;
      canWriteStudentData?: boolean;
      canViewStudentData?: boolean;
      canViewEmployeeData?: boolean;
      canManageEnrollments?: boolean;
      canManageTeacherAssignments?: boolean;
      id?: string;
      email?: string;
    },
  ): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const adminId = options?.id ?? "test-db-admin-id";
    const email = options?.email ?? "test_dbadmin@millennia21.id";
    const resolvedUnitId = await this.resolveUnitId(unitId);

    const { accessToken, refreshToken } = await generateTestTokens(
      adminId,
      email,
      AdminRole.DATABASE_ADMIN,
    );

    await prismaClient.adminUser.create({
      data: {
        id: adminId,
        email: email,
        full_name: "Test Database Admin",
        role: AdminRole.DATABASE_ADMIN,
        unit_id: resolvedUnitId,
        can_view_sensitive_data: options?.canViewSensitiveData ?? false,
        can_view_all_units: options?.canViewAllUnits ?? false,
        can_view_employee_pii: options?.canViewEmployeePii ?? false,
        can_write_employee_data: options?.canWriteEmployeeData ?? true,
        can_write_student_data: options?.canWriteStudentData ?? true,
        can_view_student_data: options?.canViewStudentData ?? true,
        can_view_employee_data: options?.canViewEmployeeData ?? true,
        can_manage_enrollments: options?.canManageEnrollments ?? true,
        can_manage_teacher_assignments:
          options?.canManageTeacherAssignments ?? true,

        after_hours_write_until: new Date("2099-01-01T00:00:00.000Z"),
        is_active: true,
        refresh_token_hash: hashToken(refreshToken),
        refresh_token_exp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  static async createViewer(
    unitId?: string,
    options?: {
      canViewSensitiveData?: boolean;
      canViewStudentData?: boolean;
      canViewEmployeeData?: boolean;
      id?: string;
      email?: string;
    },
  ): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const adminId = options?.id ?? "test-viewer-id";
    const email = options?.email ?? "test_viewer@millennia21.id";
    const resolvedUnitId = await this.resolveUnitId(unitId);

    const { accessToken, refreshToken } = await generateTestTokens(
      adminId,
      email,
      AdminRole.VIEWER,
    );

    await prismaClient.adminUser.create({
      data: {
        id: adminId,
        email: email,
        full_name: "Test Viewer",
        unit_id: resolvedUnitId,
        role: AdminRole.VIEWER,
        can_view_sensitive_data: options?.canViewSensitiveData ?? false,
        can_view_student_data: options?.canViewStudentData ?? true,
        can_view_employee_data: options?.canViewEmployeeData ?? true,
        is_active: true,
        refresh_token_hash: hashToken(refreshToken),
        refresh_token_exp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken };
  }
}

// academic_years_single_active_idx allows at most one ACTIVE academic year
// at a time. The shared dev DB this test suite runs against always has a
// real, non-TEST_ ACTIVE year seeded - create() suspends it (COMPLETED) for
// the duration of the test and delete() restores it, so tests can have
// their own ACTIVE TEST_ year without violating the constraint.
let suspendedActiveAcademicYearId: string | null = null;

export class AcademicYearTest {
  static async delete() {
    // Delete only unattached academic years created by tests.
    const year = new Date().getFullYear();
    await prismaClient.academicYear.deleteMany({
      where: {
        classes: { none: {} },
        students_joined: { none: {} },
        OR: [
          { name: { startsWith: "TEST_" } },
          { name: { contains: "Test Year" } },
          {
            name: {
              in: [
                `${year - 1}/${year}`,
                `${year}/${year + 1}`,
                `${year + 1}/${year + 2}`,
                `${year + 10}/${year + 11}`,
                `${year + 20}/${year + 21}`,
                `${year + 21}/${year + 22}`,
                `${year + 22}/${year + 23}`,
              ],
            },
          },
        ],
      },
    });

    if (suspendedActiveAcademicYearId) {
      const id = suspendedActiveAcademicYearId;
      suspendedActiveAcademicYearId = null;
      await prismaClient.academicYear
        .update({ where: { id }, data: { status: AcademicYearStatus.ACTIVE } })
        .catch(() => {});
    }
  }

  static async create() {
    const token = Date.now() + Math.floor(Math.random() * 1000);
    const start = new Date(Date.UTC(3000, 0, 1, 0, 0, 0, token % 1000));
    const end = new Date(start.getTime() + 1);
    return await prismaClient.$transaction(async (tx) => {
      const currentActive = await tx.academicYear.findFirst({
        where: { status: AcademicYearStatus.ACTIVE },
      });
      if (currentActive && !currentActive.name.startsWith("TEST_")) {
        await tx.academicYear.update({
          where: { id: currentActive.id },
          data: { status: AcademicYearStatus.COMPLETED },
        });
        suspendedActiveAcademicYearId = currentActive.id;
      }
      return tx.academicYear.create({
        data: {
          name: `TEST_AcademicYear_${token}`,
          status: AcademicYearStatus.ACTIVE,
          start_date: start,
          end_date: end,
        },
      });
    });
  }
}

export class GradeTest {
  static async getByName(name: string) {
    return prismaClient.grade.findUniqueOrThrow({ where: { name } });
  }
  static async delete() {
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
  }
}

export class ClassTest {
  static async delete() {
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
  }

  static async create(params: {
    name?: string;
    gradeId: string;
    academicYearId: string;
    status?: ClassStatus;
    capacity?: number;
  }) {
    return prismaClient.class.create({
      data: {
        name: params.name ?? `TEST_Class_${Date.now()}`,
        grade_id: params.gradeId,
        academic_year_id: params.academicYearId,
        status: params.status ?? ClassStatus.ACTIVE,
        capacity: params.capacity,
      },
    });
  }

  // Create the class and its open homeroom assignment.
  static async createWithHomeroomTeacher(params: {
    name?: string;
    gradeId: string;
    academicYearId: string;
    employeeId: string;
    status?: ClassStatus;
    capacity?: number;
  }) {
    const klass = await ClassTest.create(params);
    await prismaClient.classTeacherAssignment.create({
      data: {
        class_id: klass.id,
        employee_id: params.employeeId,
        role: ClassTeacherRole.HOMEROOM,
      },
    });
    return klass;
  }
}

export class TestRequest {
  private static makeHeaders(
    accessToken?: string,
    customHeaders: Record<string, string> = {},
  ): Headers {
    const headers = new Headers(customHeaders);

    if (!headers.has("Content-Type")) {
      headers.append("Content-Type", "application/json");
    }

    if (accessToken) {
      headers.append("Cookie", `access_token=${accessToken}`);
    }
    return headers;
  }

  private static createMockEnv() {
    return {
      server: {
        requestIP: () => {
          const randomIP = `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
          return { address: randomIP, family: "IPv4" };
        },
      },
    };
  }

  static async post<T>(
    url: string,
    body: T,
    accessToken?: string,
    customHeaders?: Record<string, string>,
  ): Promise<Response> {
    return web.request(
      url,
      {
        method: "POST",
        headers: this.makeHeaders(accessToken, customHeaders),
        body: JSON.stringify(body),
      },
      this.createMockEnv(),
    );
  }

  static async postWithCookies<T>(
    url: string,
    body: T,
    cookies: Record<string, string>,
  ): Promise<Response> {
    const headers = new Headers({ "Content-Type": "application/json" });
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    headers.append("Cookie", cookieStr);

    return web.request(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      this.createMockEnv(),
    );
  }

  static async get(
    url: string,
    accessToken?: string,
    customHeaders?: Record<string, string>,
  ): Promise<Response> {
    return web.request(
      url,
      {
        method: "GET",
        headers: this.makeHeaders(accessToken, customHeaders),
      },
      this.createMockEnv(),
    );
  }

  static async patch<T>(
    url: string,
    body: T,
    accessToken?: string,
  ): Promise<Response> {
    return web.request(
      url,
      {
        method: "PATCH",
        headers: this.makeHeaders(accessToken),
        body: JSON.stringify(body),
      },
      this.createMockEnv(),
    );
  }

  static async delete(url: string, accessToken?: string): Promise<Response> {
    return web.request(
      url,
      {
        method: "DELETE",
        headers: this.makeHeaders(accessToken),
      },
      this.createMockEnv(),
    );
  }

  static async postMultipart(
    url: string,
    formData: FormData,
    accessToken?: string,
  ): Promise<Response> {
    const headers = new Headers();
    if (accessToken) {
      headers.append("Cookie", `access_token=${accessToken}`);
      headers.append("Origin", "http://localhost:5173");
    }

    return web.request(
      url,
      {
        method: "POST",
        headers: headers,
        body: formData,
      },
      this.createMockEnv(),
    );
  }
}

export class MasterDataTest {
  static async delete() {
    const testUnitGrades = {
      unit: { name: { startsWith: "TEST_" } },
    };
    // Base units get auto-generated ids, not the fixed "unit_kindergarten"
    // style slugs this cleanup used to hardcode ("unit_unknown_legacy" is
    // the one exception, seeded with a fixed id on purpose) - resolve them
    // by name instead so this doesn't silently break every time the seed
    // runs against a fresh database.
    const [kindergarten, elementary, juniorHigh, unknownLegacy] = await Promise.all([
      prismaClient.masterUnit.findUniqueOrThrow({ where: { name: "Kindergarten" } }),
      prismaClient.masterUnit.findUniqueOrThrow({ where: { name: "Elementary" } }),
      prismaClient.masterUnit.findUniqueOrThrow({ where: { name: "Junior High" } }),
      prismaClient.masterUnit.findUniqueOrThrow({ where: { name: "Unknown / Legacy" } }),
    ]);
    await prismaClient.grade.updateMany({
      where: { ...testUnitGrades, level: { gte: -3, lte: 0 } },
      data: { unit_id: kindergarten.id },
    });
    await prismaClient.grade.updateMany({
      where: { ...testUnitGrades, level: { gte: 1, lte: 6 } },
      data: { unit_id: elementary.id },
    });
    await prismaClient.grade.updateMany({
      where: { ...testUnitGrades, level: { gte: 7, lte: 9 } },
      data: { unit_id: juniorHigh.id },
    });
    await prismaClient.grade.updateMany({
      where: { ...testUnitGrades, OR: [{ level: { lt: -3 } }, { level: { gt: 9 } }] },
      data: { unit_id: unknownLegacy.id },
    });
    await prismaClient.masterUnit.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.masterJobPosition.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.masterJobLevel.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.masterBuilding.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
  }

  static async create() {
    const unit = await prismaClient.masterUnit.create({
      data: { name: "TEST_UNIT_SHIELD" },
    });
    const position = await prismaClient.masterJobPosition.create({
      data: { name: "TEST_POS_TEACHER" },
    });
    const level = await prismaClient.masterJobLevel.create({
      data: { name: "TEST_LVL_STAFF" },
    });
    const building = await prismaClient.masterBuilding.create({
      data: { name: "TEST_BUILDING_MAIN" },
    });

    return { unit, position, level, building };
  }
}

export class ApiClientTest {
  static async delete() {
    await prismaClient.apiClient.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
  }

  static async create(params?: { name?: string }) {
    const suffix = randomBytes(4).toString("hex");
    return prismaClient.apiClient.create({
      data: {
        name: params?.name ?? `TEST_CLIENT_${suffix}`,
        token_prefix: `test_${suffix}`,
        token_hash: hashToken(randomBytes(16).toString("hex")),
      },
    });
  }
  static async createWithToken(params?: {
    name?: string;
    scopeNames?: string[];
    isActive?: boolean;
  }) {
    const suffix = randomBytes(4).toString("hex");
    const scopeNames = params?.scopeNames ?? ["employees:read"];

    const scopes = await Promise.all(
      scopeNames.map((name) =>
        prismaClient.apiScope.upsert({
          where: { name },
          update: {},
          create: { name },
        }),
      ),
    );

    const generatedToken = generateApiToken();

    const client = await prismaClient.apiClient.create({
      data: {
        name: params?.name ?? `TEST_CLIENT_${suffix}`,
        token_prefix: generatedToken.token_prefix,
        token_hash: generatedToken.token_hash,
        is_active: params?.isActive ?? true,
        scopes: { create: scopes.map((scope) => ({ scope_id: scope.id })) },
      },
    });

    return { client, token: generatedToken.token };
  }
}

export class AuditLogTest {
  static async delete() {
    await prismaClient.auditLog.deleteMany({});
  }
}

export class EmployeeTest {
  static async delete() {
    // Mutation history must be deleted before employees.
    await prismaClient.employeeMutationHistory.deleteMany({
      where: { employee: { employee_id: { startsWith: "99.99." } } },
    });
    // Delete restricted attachments and actions before employees.
    await prismaClient.disciplinaryActionAttachment.deleteMany({
      where: {
        disciplinary_action: {
          employee: { employee_id: { startsWith: "99.99." } },
        },
      },
    });
    await prismaClient.employeeDisciplinaryAction.deleteMany({
      where: { employee: { employee_id: { startsWith: "99.99." } } },
    });
    await prismaClient.employee.deleteMany({
      where: { employee_id: { startsWith: "99.99." } },
    });
    // Delete only orphaned non-student Person fixtures.
    await prismaClient.person.deleteMany({
      where: {
        email: { contains: "@millennia21.id" },
        student: null,
        employee: null,
      },
    });
  }

  static async create(params: {
    email: string;
    unitId: string;
    jobPositionId: string;
    jobLevelId: string;
    buildingId: string;
    employeeId?: string;
    status?: EmployeeStatus;
    employmentType?: EmploymentType;
  }) {
    return prismaClient.person.create({
      data: {
        full_name: "Test Employee",
        nick_name: "Test",
        email: params.email,
        person_type: PersonType.EMPLOYEE,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01"),
        employee: {
          create: {
            employee_id: params.employeeId ?? `99.99.${Date.now()}`,
            status: params.status ?? EmployeeStatus.ACTIVE,
            employment_type: params.employmentType ?? EmploymentType.PERMANENT,
            unit_id: params.unitId,
            job_position_id: params.jobPositionId,
            job_level_id: params.jobLevelId,
            building_id: params.buildingId,
            join_date: new Date("2026-01-01"),
            marital_status: MaritalStatus.SINGLE,
          },
        },
      },
      include: { employee: true },
    });
  }

  static async createWithToken(params: {
    email: string;
    unitId: string;
    jobPositionId: string;
    jobLevelId: string;
    buildingId: string;
    employeeId?: string;
    status?: EmployeeStatus;
  }) {
    const person = await this.create(params);
    const accessToken = await generateEmployeeAccessToken(
      person.employee!.id,
      person.email,
    );

    return { person, accessToken };
  }
}

export class InternTest {
  static async delete() {
    const internFilter = { intern: { email: { contains: "test_intern_" } } };
    await prismaClient.classTeacherAssignment.deleteMany({ where: internFilter });
    await prismaClient.studentSupportAssignment.deleteMany({ where: internFilter });
    await prismaClient.pCActivityDefaultMentor.deleteMany({ where: internFilter });
    await prismaClient.pCActivityMentorMutationHistory.deleteMany({
      where: internFilter,
    });
    await prismaClient.internMutationHistory.deleteMany({
      where: internFilter,
    });
    await prismaClient.intern.deleteMany({
      where: { email: { contains: "test_intern_" } },
    });
  }

  static async create(params: {
    email: string;
    unitId: string;
    jobPositionId: string;
    buildingId: string;
    status?: InternStatus;
    mobilePhone?: string;
    residentialAddress?: string;
  }) {
    return prismaClient.intern.create({
      data: {
        full_name: "Test Intern",
        nick_name: "Test",
        email: params.email,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2003-01-01"),
        mobile_phone: params.mobilePhone,
        residential_address: params.residentialAddress,
        status: params.status ?? InternStatus.ACTIVE,
        unit_id: params.unitId,
        job_position_id: params.jobPositionId,
        building_id: params.buildingId,
        join_date: new Date("2026-01-01"),
        end_date: new Date("2026-06-30"),
      },
    });
  }
}

export class StudentTest {
  static async delete() {
    // Delete restricted history and enrollment rows before students.
    await prismaClient.studentMutationHistory.deleteMany({
      where: { student: { person: { email: { contains: "@millennia21.id" } } } },
    });
    await prismaClient.studentClassEnrollment.deleteMany({
      where: { student: { person: { email: { contains: "@millennia21.id" } } } },
    });
    await prismaClient.student.deleteMany({
      where: { person: { email: { contains: "@millennia21.id" } } },
    });
    // Preserve Person rows still owned by employees.
    await prismaClient.person.deleteMany({
      where: {
        email: { contains: "@millennia21.id" },
        employee: null,
      },
    });
    await prismaClient.grade.deleteMany({
      where: { name: "TEST_STUDENT_GRADE" },
    });
    await prismaClient.academicYear.deleteMany({
      where: { name: "TEST_STUDENT_YEAR" },
    });
  }

  static async resolveGradeId(gradeId?: string): Promise<string> {
    if (gradeId) return gradeId;
    const existing = await prismaClient.grade.findFirst({
      where: { name: "TEST_STUDENT_GRADE" },
    });
    if (existing) return existing.id;
    // Use the default test unit so scoped admin fixtures can see the student.
    let unit = await prismaClient.masterUnit.findFirst({
      where: { name: { startsWith: "TEST_" } },
      orderBy: { created_at: "desc" },
    });
    if (!unit) {
      // Upsert to tolerate concurrent test fixture creation.
      unit = await prismaClient.masterUnit.upsert({
        where: { name: "TEST_UNIT_SHIELD" },
        update: {},
        create: { name: "TEST_UNIT_SHIELD" },
      });
    }
    const created = await prismaClient.grade.create({
      data: { name: "TEST_STUDENT_GRADE", level: -9999, unit_id: unit.id },
    });
    return created.id;
  }

  static async resolveAcademicYearId(academicYearId?: string): Promise<string> {
    if (academicYearId) return academicYearId;
    const existingActive = await prismaClient.academicYear.findFirst({
      where: { status: AcademicYearStatus.ACTIVE },
    });
    if (existingActive) return existingActive.id;
    // NIS generation derives year digits from start_date.
    const created = await prismaClient.academicYear.create({
      data: {
        name: "TEST_STUDENT_YEAR",
        status: AcademicYearStatus.ACTIVE,
        start_date: new Date("2026-01-01"),
      },
    });
    return created.id;
  }

  static async create(params: {
    email: string;
    nis?: string;
    nisn?: string;
    status?: StudentStatus;
    currentGradeId?: string;
    joinGradeId?: string;
    joinAcademicYearId?: string;
    currentClassId?: string;
    entry_type?: StudentEntryType;
    // Tests using seeded grades must provide an age-appropriate birth date.
    birthDate?: Date;
  }) {
    const currentGradeId = await this.resolveGradeId(params.currentGradeId);
    const joinGradeId = await this.resolveGradeId(
      params.joinGradeId ?? params.currentGradeId,
    );
    const joinAcademicYearId = await this.resolveAcademicYearId(
      params.joinAcademicYearId,
    );

    return prismaClient.person.create({
      data: {
        full_name: "Test Student",
        nick_name: "Test",
        email: params.email,
        person_type: PersonType.STUDENT,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: params.birthDate ?? new Date("2010-01-01"),
        student: {
          create: {
            nis:
              params.nis ??
              String(Math.floor(1000000 + Math.random() * 9000000)),
            nisn: params.nisn,
            status: params.status ?? StudentStatus.ACTIVE,
            current_grade_id: currentGradeId,
            join_grade_id: joinGradeId,
            join_academic_year_id: joinAcademicYearId,
            current_class_id: params.currentClassId,
            entry_type: params.entry_type ?? StudentEntryType.PSB,
          },
        },
      },
      include: { student: true },
    });
  }
}

// Run before StudentTest.delete() because the FK is restricted.
export class EnrollmentTest {
  static async delete() {
    await prismaClient.studentClassEnrollment.deleteMany({
      where: {
        student: { person: { email: { contains: "@millennia21.id" } } },
      },
    });
  }

  static async create(params: {
    studentId: string;
    classId: string;
    academicYearId: string;
    gradeLevel: string;
    // Resolve the grade ID from the snapshot name when omitted.
    gradeId?: string;
    classNameSnapshot?: string;
    status?: EnrollmentStatus;
    startDate?: Date;
    endDate?: Date;
    deletedAt?: Date;
  }) {
    // Fall back to the class grade for fabricated snapshot names.
    const gradeId =
      params.gradeId ??
      (
        await prismaClient.grade.findFirst({
          where: { name: params.gradeLevel },
        })
      )?.id ??
      (
        await prismaClient.class.findUniqueOrThrow({
          where: { id: params.classId },
          select: { grade_id: true },
        })
      ).grade_id;

    return prismaClient.studentClassEnrollment.create({
      data: {
        student_id: params.studentId,
        academic_year_id: params.academicYearId,
        class_id: params.classId,
        grade_id: gradeId,
        grade_level: params.gradeLevel,
        class_name_snapshot: params.classNameSnapshot ?? "TEST_Class",
        enrollment_status: params.status ?? EnrollmentStatus.ACTIVE,
        start_date: params.startDate,
        end_date: params.endDate,
        deleted_at: params.deletedAt,
      },
    });
  }
}

// Run before StudentTest.delete() because the FK is restricted.
export class ParentGuardianTest {
  static async delete() {
    await prismaClient.parentGuardian.deleteMany({
      where: {
        student: { person: { email: { contains: "@millennia21.id" } } },
      },
    });
  }

  static async create(params: {
    studentId: string;
    type?: ParentType;
    fullName?: string;
    phone?: string;
    email?: string;
    address?: string;
    isPrimary?: boolean;
    deletedAt?: Date;
  }) {
    return prismaClient.parentGuardian.create({
      data: {
        student_id: params.studentId,
        type: params.type ?? ParentType.FATHER,
        full_name: params.fullName ?? "Test Parent",
        phone: params.phone,
        email: params.email,
        address: params.address,
        is_primary: params.isPrimary ?? false,
        deleted_at: params.deletedAt,
      },
    });
  }
}

// Run before StudentTest.delete() because the FK is restricted.
export class ConsentTest {
  static async delete() {
    await prismaClient.consentRecord.deleteMany({
      where: {
        student: { person: { email: { contains: "@millennia21.id" } } },
      },
    });
  }

  static async create(params: {
    studentId: string;
    consentType?: ConsentType;
    status?: ConsentStatus;
    consentDate?: Date;
    signedBy?: string;
    notes?: string;
    validityPeriod?: Date;
    deletedAt?: Date;
  }) {
    return prismaClient.consentRecord.create({
      data: {
        student_id: params.studentId,
        consent_type: params.consentType ?? ConsentType.MEDIA_CONSENT,
        status: params.status ?? ConsentStatus.PENDING,
        consent_date: params.consentDate,
        signed_by: params.signedBy,
        notes: params.notes,
        validity_period: params.validityPeriod,
        deleted_at: params.deletedAt,
      },
    });
  }
}

// Run before ConsentTest.delete() because the FK is restricted.
export class ConsentAttachmentTest {
  static async delete() {
    await prismaClient.consentAttachment.deleteMany({
      where: {
        consent: {
          student: { person: { email: { contains: "@millennia21.id" } } },
        },
      },
    });
  }

  // Insert attachment metadata without uploading to MinIO.
  static async create(params: {
    consentId: string;
    fileName?: string;
    objectKey?: string;
    fileSize?: number;
    mimeType?: string;
    uploadedBy: string;
    deletedAt?: Date;
  }) {
    return prismaClient.consentAttachment.create({
      data: {
        consent_id: params.consentId,
        file_name: params.fileName ?? "consent-letter.pdf",
        object_key: params.objectKey ?? `test/${Date.now()}-${Math.random()}`,
        file_size: params.fileSize ?? 1024,
        mime_type: params.mimeType ?? "application/pdf",
        uploaded_by: params.uploadedBy,
        deleted_at: params.deletedAt,
      },
    });
  }

  // List uploaded objects for orphan-cleanup assertions.
  static async listMinioObjects(consentId: string): Promise<string[]> {
    const prefix = `consent-attachments/${consentId}/`;
    const keys: string[] = [];
    const stream = minioClient.listObjectsV2(MINIO_BUCKET, prefix, true);
    for await (const obj of stream) {
      if (obj.name) keys.push(obj.name);
    }
    return keys;
  }

  // Remove an object uploaded through the HTTP endpoint.
  static async removeFromMinio(attachmentId: string): Promise<void> {
    const attachment = await prismaClient.consentAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) return;
    await minioClient.removeObject(MINIO_BUCKET, attachment.object_key).catch(() => {});
  }
}

export class DisciplinaryActionAttachmentTest {
  static async delete() {
    await prismaClient.disciplinaryActionAttachment.deleteMany({
      where: {
        disciplinary_action: {
          employee: { employee_id: { startsWith: "99.99." } },
        },
      },
    });
  }

  // Insert attachment metadata without uploading to MinIO.
  static async create(params: {
    disciplinaryActionId: string;
    fileName?: string;
    objectKey?: string;
    fileSize?: number;
    mimeType?: string;
    uploadedBy: string;
    deletedAt?: Date;
  }) {
    return prismaClient.disciplinaryActionAttachment.create({
      data: {
        disciplinary_action_id: params.disciplinaryActionId,
        file_name: params.fileName ?? "st-letter.pdf",
        object_key: params.objectKey ?? `test/${Date.now()}-${Math.random()}`,
        file_size: params.fileSize ?? 1024,
        mime_type: params.mimeType ?? "application/pdf",
        uploaded_by: params.uploadedBy,
        deleted_at: params.deletedAt,
      },
    });
  }

  // List uploaded objects for orphan-cleanup assertions.
  static async listMinioObjects(disciplinaryActionId: string): Promise<string[]> {
    const prefix = `disciplinary-attachments/${disciplinaryActionId}/`;
    const keys: string[] = [];
    const stream = minioClient.listObjectsV2(MINIO_BUCKET, prefix, true);
    for await (const obj of stream) {
      if (obj.name) keys.push(obj.name);
    }
    return keys;
  }

  // Cleans up a real MinIO object left behind by a test that actually
  // uploaded through the HTTP endpoint (not the DB-only create() above).
  static async removeFromMinio(attachmentId: string): Promise<void> {
    const attachment = await prismaClient.disciplinaryActionAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) return;
    await minioClient.removeObject(MINIO_BUCKET, attachment.object_key).catch(() => {});
  }
}

export class StudentPhotoTest {
  // Lists real objects uploaded to MinIO under a student's photo prefix -
  // used to prove upload()'s replace-on-upload cleanup actually ran.
  static async listMinioObjects(studentId: string): Promise<string[]> {
    const prefix = `student-photos/${studentId}/`;
    const keys: string[] = [];
    const stream = minioClient.listObjectsV2(MINIO_BUCKET, prefix, true);
    for await (const obj of stream) {
      if (obj.name) keys.push(obj.name);
    }
    return keys;
  }

  // Cleans up whatever real MinIO object a test's HTTP-level upload left
  // behind, keyed by the student's current photo_object_key.
  static async removeFromMinio(studentId: string): Promise<void> {
    const person = await prismaClient.person.findFirst({
      where: { student: { id: studentId } },
      select: { photo_object_key: true },
    });
    if (!person?.photo_object_key) return;
    await minioClient
      .removeObject(MINIO_BUCKET, person.photo_object_key)
      .catch(() => {});
  }
}

export class EmployeePhotoTest {
  // Lists real objects uploaded to MinIO under an employee's photo prefix -
  // used to prove upload()'s replace-on-upload cleanup actually ran.
  static async listMinioObjects(employeeId: string): Promise<string[]> {
    const prefix = `employee-photos/${employeeId}/`;
    const keys: string[] = [];
    const stream = minioClient.listObjectsV2(MINIO_BUCKET, prefix, true);
    for await (const obj of stream) {
      if (obj.name) keys.push(obj.name);
    }
    return keys;
  }

  // Cleans up whatever real MinIO object a test's HTTP-level upload left
  // behind, keyed by the employee's current photo_object_key.
  static async removeFromMinio(employeeId: string): Promise<void> {
    const person = await prismaClient.person.findFirst({
      where: { employee: { id: employeeId } },
      select: { photo_object_key: true },
    });
    if (!person?.photo_object_key) return;
    await minioClient
      .removeObject(MINIO_BUCKET, person.photo_object_key)
      .catch(() => {});
  }
}

// FK is ON DELETE RESTRICT - run before StudentTest.delete()
export class HealthRecordTest {
  static async delete() {
    await prismaClient.healthRecord.deleteMany({
      where: {
        student: { person: { email: { contains: "@millennia21.id" } } },
      },
    });
  }

  static async create(params: {
    studentId: string;
    bloodType?: BloodType;
    needsAssistance?: boolean;
    deletedAt?: Date;
  }) {
    return prismaClient.healthRecord.create({
      data: {
        student_id: params.studentId,
        blood_type: params.bloodType,
        needs_assistance: params.needsAssistance ?? false,
        deleted_at: params.deletedAt,
      },
    });
  }
}

// FK is ON DELETE RESTRICT - run before StudentTest.delete()
export class HealthNoteTest {
  static async delete() {
    await prismaClient.healthNote.deleteMany({
      where: {
        student: { person: { email: { contains: "@millennia21.id" } } },
      },
    });
  }

  static async create(params: {
    studentId: string;
    category?: HealthNoteCategory;
    description?: string;
    status?: HealthNoteStatus;
    notedDate?: Date;
    resolvedDate?: Date;
    deletedAt?: Date;
  }) {
    return prismaClient.healthNote.create({
      data: {
        student_id: params.studentId,
        category: params.category ?? HealthNoteCategory.HEALTH_INFO,
        description: params.description ?? "Test note",
        status: params.status ?? HealthNoteStatus.ACTIVE,
        noted_date: params.notedDate,
        resolved_date: params.resolvedDate,
        deleted_at: params.deletedAt,
      },
    });
  }
}

// FK is ON DELETE RESTRICT - run before StudentTest.delete()
export class VaccineRecordTest {
  static async delete() {
    await prismaClient.vaccineRecord.deleteMany({
      where: {
        student: { person: { email: { contains: "@millennia21.id" } } },
      },
    });
  }

  static async create(params: {
    studentId: string;
    vaccineType?: VaccineType;
    received?: boolean;
    date?: Date;
    deletedAt?: Date;
  }) {
    return prismaClient.vaccineRecord.create({
      data: {
        student_id: params.studentId,
        vaccine_type: params.vaccineType ?? VaccineType.POLIO,
        received: params.received ?? false,
        date: params.date,
        deleted_at: params.deletedAt,
      },
    });
  }
}

export class PCActivityTest {
  static async delete() {
    await prismaClient.passionConnectionActivity.deleteMany({
      where: {
        student: { person: { email: { contains: "@millennia21.id" } } },
      },
    });
  }

  // Resolve or create the named master activity for existing call sites.
  static async resolveActivityId(activityName?: string): Promise<string> {
    const activity = await prismaClient.masterPCActivity.upsert({
      where: { name: activityName ?? "Basketball" },
      update: {},
      create: { name: activityName ?? "Basketball" },
    });
    return activity.id;
  }

  static async create(params: {
    studentId: string;
    day?: PCDay;
    activity?: string;
    academicYearId?: string;
    deletedAt?: Date;
  }) {
    const academicYearId = await StudentTest.resolveAcademicYearId(
      params.academicYearId,
    );
    const activityId = await this.resolveActivityId(params.activity);
    return prismaClient.passionConnectionActivity.create({
      data: {
        student_id: params.studentId,
        day: params.day ?? PCDay.MONDAY,
        activity_id: activityId,
        academic_year_id: academicYearId,
        deleted_at: params.deletedAt,
      },
    });
  }
}

export class WorkingDayTest {
  static async delete() {
    await prismaClient.workingDayOverride.deleteMany({
      where: { date: { gte: new Date("2100-01-01T00:00:00.000Z") } },
    });
  }

  static nextSaturdayOnOrAfter(year: number): Date {
    const start = new Date(Date.UTC(year, 0, 1));
    while (start.getUTCDay() !== 6) {
      start.setUTCDate(start.getUTCDate() + 1);
    }
    return start;
  }
}
