// Usage:
//   bun run seed/dev-data-employee.ts          seed
//   bun run seed/dev-data-employee.ts --clean  remove everything this script created
//
// Covers Employee + admin-auth basics (Unit/Job Position/Job Level, admin
// roles, employee CRUD demo data, API client)
// SEED_BASE_URL (optional): base URL used only for the printed curl
// locally. Defaults to http://localhost:3000. Does not affect what DB this
// IMPORTANT: run --clean before `bun test`.

import { sign } from "hono/jwt";
import {
  AdminRole,
  EmployeeStatus,
  EmploymentType,
  Gender,
  MaritalStatus,
  PersonType,
  Religion,
} from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";
import { generateApiToken } from "../src/utils/generate-api-token";
import { API_SCOPES } from "../src/constants/api-scopes";

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24;
// Deliberately NOT @millennia21.id: the test suite's cleanup helpers
const ADMIN_EMAIL = "dev.superadmin@mws-dev.local";
const DB_ADMIN_EMAIL = "dev.dbadmin@mws-dev.local";
const VIEWER_EMAIL = "dev.viewer@mws-dev.local";
const EMPLOYEE_EMAIL = "dev.employee@mws-dev.local";
const EMPLOYEE_ID = "DEV.0001";
const UNIT_2_NAME = "DEV_UNIT_2";
const EMPLOYEE_2_EMAIL = "dev.employee2@mws-dev.local";
const EMPLOYEE_2_ID = "DEV.0002";
const EMPLOYEES_READ_SCOPE = API_SCOPES.EMPLOYEES_READ;
const DEV_API_CLIENT_NAME = "DEV_INTERNAL_CLIENT";

async function signAccessToken(payload: Record<string, unknown>) {
  return sign(
    {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
    },
    JWT_SECRET!,
    "HS256",
  );
}

async function clean() {
  const unit = await prismaClient.masterUnit.findUnique({
    where: { name: "DEV_UNIT" },
  });
  const unit2 = await prismaClient.masterUnit.findUnique({
    where: { name: UNIT_2_NAME },
  });
  const position = await prismaClient.masterJobPosition.findUnique({
    where: { name: "DEV_POSITION" },
  });
  const level = await prismaClient.masterJobLevel.findUnique({
    where: { name: "DEV_LEVEL" },
  });

  const orConditions = [
    unit && { unit_id: unit.id },
    unit2 && { unit_id: unit2.id },
    position && { job_position_id: position.id },
    level && { job_level_id: level.id },
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));

  if (orConditions.length > 0) {
    const orphanEmployees = await prismaClient.employee.findMany({
      where: { OR: orConditions },
      select: { id: true, person_id: true },
    });

    for (const employee of orphanEmployees) {
      await prismaClient.employee.delete({ where: { id: employee.id } });
    }
    await prismaClient.person.deleteMany({
      where: { id: { in: orphanEmployees.map((e) => e.person_id) } },
    });
  }

  await prismaClient.adminUser.deleteMany({
    where: { email: { in: [ADMIN_EMAIL, DB_ADMIN_EMAIL, VIEWER_EMAIL] } },
  });
  await prismaClient.masterUnit.deleteMany({
    where: { name: { in: ["DEV_UNIT", UNIT_2_NAME] } },
  });
  await prismaClient.masterJobPosition.deleteMany({
    where: { name: "DEV_POSITION" },
  });
  await prismaClient.masterJobLevel.deleteMany({
    where: { name: "DEV_LEVEL" },
  });
  await prismaClient.apiClient.deleteMany({
    where: { name: DEV_API_CLIENT_NAME },
  });
  await prismaClient.apiScope.deleteMany({
    where: { name: EMPLOYEES_READ_SCOPE },
  });

  console.log("Dev seed data removed.");
}

async function main() {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set — check server/.env");
  }

  const unit = await prismaClient.masterUnit.upsert({
    where: { name: "DEV_UNIT" },
    update: {},
    create: { name: "DEV_UNIT" },
  });

  const position = await prismaClient.masterJobPosition.upsert({
    where: { name: "DEV_POSITION" },
    update: {},
    create: { name: "DEV_POSITION" },
  });

  const level = await prismaClient.masterJobLevel.upsert({
    where: { name: "DEV_LEVEL" },
    update: {},
    create: { name: "DEV_LEVEL" },
  });

  const unit2 = await prismaClient.masterUnit.upsert({
    where: { name: UNIT_2_NAME },
    update: {},
    create: { name: UNIT_2_NAME },
  });

  const admin = await prismaClient.adminUser.upsert({
    where: { email: ADMIN_EMAIL },
    update: { is_active: true, role: AdminRole.SUPER_ADMIN },
    create: {
      email: ADMIN_EMAIL,
      full_name: "Dev Super Admin",
      role: AdminRole.SUPER_ADMIN,
      unit_id: unit.id,
      is_active: true,
    },
  });

  const adminAccessToken = await signAccessToken({
    id: admin.id,
    email: admin.email,
    role: admin.role,
  });

  const dbAdmin = await prismaClient.adminUser.upsert({
    where: { email: DB_ADMIN_EMAIL },
    update: {
      is_active: true,
      role: AdminRole.DATABASE_ADMIN,
      unit_id: unit.id,
    },
    create: {
      email: DB_ADMIN_EMAIL,
      full_name: "Dev Database Admin",
      role: AdminRole.DATABASE_ADMIN,
      unit_id: unit.id,
      can_write_data: true,
      is_active: true,
    },
  });

  const dbAdminAccessToken = await signAccessToken({
    id: dbAdmin.id,
    email: dbAdmin.email,
    role: dbAdmin.role,
  });

  const viewer = await prismaClient.adminUser.upsert({
    where: { email: VIEWER_EMAIL },
    update: { is_active: true, role: AdminRole.VIEWER, unit_id: unit.id },
    create: {
      email: VIEWER_EMAIL,
      full_name: "Dev Viewer",
      role: AdminRole.VIEWER,
      unit_id: unit.id,
      is_active: true,
    },
  });

  const viewerAccessToken = await signAccessToken({
    id: viewer.id,
    email: viewer.email,
    role: viewer.role,
  });

  let employeePerson = await prismaClient.person.findUnique({
    where: { email: EMPLOYEE_EMAIL },
    include: { employee: true },
  });

  if (!employeePerson) {
    employeePerson = await prismaClient.person.create({
      data: {
        full_name: "Dev Employee",
        nick_name: "Dev",
        email: EMPLOYEE_EMAIL,
        person_type: PersonType.EMPLOYEE,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01"),
        employee: {
          create: {
            employee_id: EMPLOYEE_ID,
            status: EmployeeStatus.ACTIVE,
            employment_type: EmploymentType.PERMANENT,
            unit_id: unit.id,
            job_position_id: position.id,
            job_level_id: level.id,
            building: "Dev Building",
            join_date: new Date("2026-01-01"),
            marital_status: MaritalStatus.SINGLE,
          },
        },
      },
      include: { employee: true },
    });
  }
  const employee = employeePerson.employee!;

  const employeeAccessToken = await signAccessToken({
    id: employee.id,
    email: employeePerson.email,
    type: "employee",
  });

  // Lives in unit2, outside dbAdmin's scope — use this one to demo the
  // "Forbidden: outside your unit scope" / 404 behavior.
  let employee2Person = await prismaClient.person.findUnique({
    where: { email: EMPLOYEE_2_EMAIL },
    include: { employee: true },
  });

  if (!employee2Person) {
    employee2Person = await prismaClient.person.create({
      data: {
        full_name: "Dev Employee Two",
        nick_name: "Dev2",
        email: EMPLOYEE_2_EMAIL,
        person_type: PersonType.EMPLOYEE,
        gender: Gender.FEMALE,
        religion: Religion.ISLAM,
        birth_place: "Bandung",
        birth_date: new Date("1996-02-02"),
        employee: {
          create: {
            employee_id: EMPLOYEE_2_ID,
            status: EmployeeStatus.ACTIVE,
            employment_type: EmploymentType.PERMANENT,
            unit_id: unit2.id,
            job_position_id: position.id,
            job_level_id: level.id,
            building: "Dev Building 2",
            join_date: new Date("2026-01-01"),
            marital_status: MaritalStatus.SINGLE,
          },
        },
      },
      include: { employee: true },
    });
  }
  const employee2 = employee2Person.employee!;

  const employeesReadScope = await prismaClient.apiScope.upsert({
    where: { name: EMPLOYEES_READ_SCOPE },
    update: {},
    create: {
      name: EMPLOYEES_READ_SCOPE,
      description:
        "Read employee profile data for cross-app login/provisioning",
    },
  });

  // The plaintext token only exists at creation time — it's never stored,
  // so a pre-existing client can't have it reprinted here.
  let devApiClient = await prismaClient.apiClient.findUnique({
    where: { name: DEV_API_CLIENT_NAME },
  });
  let devApiToken: string | null = null;

  if (!devApiClient) {
    const generatedToken = generateApiToken();
    devApiToken = generatedToken.token;

    devApiClient = await prismaClient.apiClient.create({
      data: {
        name: DEV_API_CLIENT_NAME,
        description: "Dev seed client for testing the internal employee API",
        token_prefix: generatedToken.token_prefix,
        token_hash: generatedToken.token_hash,
        scopes: { create: [{ scope_id: employeesReadScope.id }] },
      },
    });
  }

  const baseUrl = process.env.SEED_BASE_URL || "http://localhost:3000";

  console.log("\n=== Seed complete ===");

  console.log(
    "\n--- Copy-paste to set up your shell (matches docs/employee-walkthrough.md) ---",
  );
  console.log(`export BASE=${baseUrl}`);
  console.log(`export ADMIN_TOKEN="${adminAccessToken}"`);
  console.log(`export DB_ADMIN_TOKEN="${dbAdminAccessToken}"`);
  console.log(`export VIEWER_TOKEN="${viewerAccessToken}"`);
  if (devApiToken) {
    console.log(`export API_TOKEN="${devApiToken}"`);
  } else {
    console.log(
      "# API_TOKEN: unchanged from a previous seed run — rerun with --clean first for a fresh one",
    );
  }
  console.log(`export UNIT_ID=${unit.id}`);
  console.log(`export POSITION_ID=${position.id}`);
  console.log(`export LEVEL_ID=${level.id}`);
  console.log(`export EMPLOYEE_ID=${employee.id}`);
  console.log(`export EMPLOYEE_2_ID=${employee2.id}`);
  console.log(`export DB_ADMIN_ID=${dbAdmin.id}`);
  console.log(`export VIEWER_ID=${viewer.id}`);

  console.log("\n--- Accounts (all *_TOKEN above expire in 24h) ---");
  console.log(`SUPER_ADMIN     ${admin.email}  (sees both units)`);
  console.log(
    `DATABASE_ADMIN  ${dbAdmin.email}  (scoped to ${unit.name}, can_write_data: true)`,
  );
  console.log(
    `VIEWER          ${viewer.email}  (scoped to ${unit.name}, read-only)`,
  );

  console.log("\n--- Employees ---");
  console.log(
    `${employee.employee_id}  ${employeePerson.email}  in ${unit.name}`,
  );
  console.log(
    `${employee2.employee_id}  ${employee2Person.email}  in ${unit2.name} (use to test cross-unit blocking)`,
  );

  console.log("\n--- Try it (uses the exports above) ---");
  console.log(
    `curl -H "Cookie: access_token=$ADMIN_TOKEN" $BASE/api/admin/employees`,
  );
  console.log(
    `curl -H "Cookie: access_token=$DB_ADMIN_TOKEN" $BASE/api/admin/employees/$EMPLOYEE_2_ID   # -> 404, different unit`,
  );
  console.log(
    `curl -X PATCH -H "Content-Type: application/json" -H "Cookie: access_token=$VIEWER_TOKEN" $BASE/api/admin/employees/$EMPLOYEE_ID -d '{"building":"Nope"}'   # -> 403`,
  );
  if (devApiToken) {
    console.log(
      `curl -H "Authorization: Bearer $API_TOKEN" "$BASE/api/internal/employees/lookup?email=${employeePerson.email}"`,
    );
  }

  console.log("\n--- Not part of the export block above ---");
  console.log(
    `Employee self-service token (for /api/auth/employee/*, valid 24h):\n${employeeAccessToken}`,
  );
  console.log(
    "Thunder Client: Cookies tab -> add name=access_token, value=<any *_TOKEN above>",
  );

  console.log("");
}

const run = process.argv.includes("--clean") ? clean : main;

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
