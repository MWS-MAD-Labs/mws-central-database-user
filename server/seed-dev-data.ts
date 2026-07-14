// Usage:
//   bun run seed-dev-data.ts          seed
//   bun run seed-dev-data.ts --clean  remove everything this script created
//
// IMPORTANT: run --clean before `bun test`.

import { sign } from "hono/jwt";
import {
  AdminRole,
  EmployeeStatus,
  EmploymentType,
  Gender,
  PersonType,
  Religion,
} from "./src/generated/prisma/client";
import { prismaClient } from "./src/lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24;
// Deliberately NOT @millennia21.id: the test suite's cleanup helpers
const ADMIN_EMAIL = "dev.superadmin@mws-dev.local";
const EMPLOYEE_EMAIL = "dev.employee@mws-dev.local";
const EMPLOYEE_ID = "DEV.0001";

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
  const employee = await prismaClient.employee.findFirst({
    where: { employee_id: EMPLOYEE_ID },
  });
  if (employee) {
    await prismaClient.employee.delete({ where: { id: employee.id } });
  }
  await prismaClient.person.deleteMany({ where: { email: EMPLOYEE_EMAIL } });
  await prismaClient.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
  await prismaClient.masterUnit.deleteMany({ where: { name: "DEV_UNIT" } });
  await prismaClient.masterJobPosition.deleteMany({
    where: { name: "DEV_POSITION" },
  });
  await prismaClient.masterJobLevel.deleteMany({
    where: { name: "DEV_LEVEL" },
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

  const baseUrl = "http://localhost:3000";

  console.log("\n=== Seed complete ===");

  console.log("\n--- Master data ---");
  console.log(`unit:     ${unit.name}  (${unit.id})`);
  console.log(`position: ${position.name}  (${position.id})`);
  console.log(`level:    ${level.name}  (${level.id})`);

  console.log("\n--- Admin (SUPER_ADMIN) ---");
  console.log(`email: ${admin.email}`);
  console.log(`id:    ${admin.id}`);
  console.log(`access_token (valid 24h):\n${adminAccessToken}`);
  console.log(
    `\ncurl:\ncurl -H "Cookie: access_token=${adminAccessToken}" ${baseUrl}/api/admin/employees`,
  );
  console.log(
    `\nThunder Client: Cookies tab -> add\n  name: access_token\n  value: ${adminAccessToken}`,
  );

  console.log("\n--- Employee (for GET/PATCH/DELETE testing) ---");
  console.log(`id:          ${employee.id}`);
  console.log(`employee_id: ${employee.employee_id}`);
  console.log(`email:       ${employeePerson.email}`);
  console.log(
    `\ncurl:\ncurl -H "Cookie: access_token=${adminAccessToken}" ${baseUrl}/api/admin/employees/${employee.id}`,
  );

  console.log(
    "\n--- Employee self-service token (for /api/auth/employee/*) ---",
  );
  console.log(`access_token (valid 24h):\n${employeeAccessToken}`);

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
