import { web } from "../application/web";
import { sign } from "hono/jwt";
import { randomBytes, createHash } from "crypto";
import {
  AcademicYearStatus,
  AdminRole,
  EmployeeStatus,
  EmploymentType,
  Gender,
  PersonType,
  Religion,
} from "../generated/prisma/enums";
import { prismaClient } from "../lib/prisma";

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

    const defaultUnit = await prismaClient.masterUnit.findFirst();
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
        can_create_data: true,
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

  static async get(url: string, accessToken?: string): Promise<Response> {
    return web.request(
      url,
      {
        method: "GET",
        headers: this.makeHeaders(accessToken),
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
