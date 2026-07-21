import { web } from "../application/web";
import { sign } from "hono/jwt";
import { randomBytes, createHash } from "crypto";
import {
  AcademicYearStatus,
  AdminRole,
  ClassStatus,
  EmployeeStatus,
  EmploymentType,
  EnrollmentStatus,
  Gender,
  MaritalStatus,
  PersonType,
  Religion,
  StudentStatus,
} from "../generated/prisma/enums";
import { prismaClient } from "../lib/prisma";
import { generateApiToken } from "../utils/generate-api-token";

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
        },
      },
    });
  }

  static async createSuperAdmin(unitId?: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const adminId = "test-super-admin-id";
    const email = "test_superadmin@millennia21.id";
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

  static async createDatabaseAdmin(unitId?: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const adminId = "test-db-admin-id";
    const email = "test_dbadmin@millennia21.id";
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
        can_write_data: true,

        after_hours_write_until: new Date("2099-01-01T00:00:00.000Z"),
        is_active: true,
        refresh_token_hash: hashToken(refreshToken),
        refresh_token_exp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  static async createViewer(unitId?: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const adminId = "test-viewer-id";
    const email = "test_viewer@millennia21.id";
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
        is_active: true,
        refresh_token_hash: hashToken(refreshToken),
        refresh_token_exp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken };
  }
}

export class AcademicYearTest {
  static async delete() {
    await prismaClient.academicYear.deleteMany({
      where: {
        name: { contains: "Test Year" },
      },
    });
  }

  static async create() {
    return await prismaClient.academicYear.create({
      data: {
        name: "Test Year 2026/2027",
        status: AcademicYearStatus.ACTIVE,
      },
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
    homeroomTeacherId?: string;
    status?: ClassStatus;
  }) {
    return prismaClient.class.create({
      data: {
        name: params.name ?? `TEST_Class_${Date.now()}`,
        grade_id: params.gradeId,
        academic_year_id: params.academicYearId,
        homeroom_teacher_id: params.homeroomTeacherId,
        status: params.status ?? ClassStatus.ACTIVE,
      },
    });
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
    await prismaClient.masterUnit.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.masterJobPosition.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.masterJobLevel.deleteMany({
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

    return { unit, position, level };
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
    await prismaClient.employee.deleteMany({
      where: { employee_id: { startsWith: "99.99." } },
    });
    await prismaClient.person.deleteMany({
      where: { email: { contains: "@millennia21.id" } },
    });
  }

  static async create(params: {
    email: string;
    unitId: string;
    jobPositionId: string;
    jobLevelId: string;
    employeeId?: string;
    status?: EmployeeStatus;
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
            employment_type: EmploymentType.PERMANENT,
            unit_id: params.unitId,
            job_position_id: params.jobPositionId,
            job_level_id: params.jobLevelId,
            building: "Main Building",
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

export class StudentTest {
  static async delete() {
    await prismaClient.student.deleteMany({
      where: { person: { email: { contains: "@millennia21.id" } } },
    });
    await prismaClient.person.deleteMany({
      where: { email: { contains: "@millennia21.id" } },
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
    const created = await prismaClient.grade.create({
      data: { name: "TEST_STUDENT_GRADE", level: -9999 },
    });
    return created.id;
  }

  static async resolveAcademicYearId(academicYearId?: string): Promise<string> {
    if (academicYearId) return academicYearId;
    const existingActive = await prismaClient.academicYear.findFirst({
      where: { status: AcademicYearStatus.ACTIVE },
    });
    if (existingActive) return existingActive.id;
    const created = await prismaClient.academicYear.create({
      data: { name: "TEST_STUDENT_YEAR", status: AcademicYearStatus.ACTIVE },
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
        birth_date: new Date("2010-01-01"),
        student: {
          create: {
            nis: params.nis ?? `TEST_${Date.now()}`,
            nisn: params.nisn,
            status: params.status ?? StudentStatus.ACTIVE,
            current_grade_id: currentGradeId,
            join_grade_id: joinGradeId,
            join_academic_year_id: joinAcademicYearId,
            current_class_id: params.currentClassId,
          },
        },
      },
      include: { student: true },
    });
  }
}

// FK is ON DELETE RESTRICT - run before StudentTest.delete()
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
    classNameSnapshot?: string;
    status?: EnrollmentStatus;
    startDate?: Date;
    endDate?: Date;
  }) {
    return prismaClient.studentClassEnrollment.create({
      data: {
        student_id: params.studentId,
        academic_year_id: params.academicYearId,
        class_id: params.classId,
        grade_level: params.gradeLevel,
        class_name_snapshot: params.classNameSnapshot ?? "TEST_Class",
        enrollment_status: params.status ?? EnrollmentStatus.ACTIVE,
        start_date: params.startDate,
        end_date: params.endDate,
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
