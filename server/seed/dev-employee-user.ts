// Usage:
//   bun run seed:dev:employee-user
//
// Creates an Employee record for TARGET_EMAIL so the employee self-service
// login (Google Sign-In -> /api/auth/employee/*) can be tested from the
// frontend, and deactivates the matching AdminUser at the same time -
// employee-auth-middleware rejects login for any email that's still an
// active AdminUser ("Your account has been upgraded. Please log in
// again."), so both can't be active together.
//
// To switch back to testing as admin: bun run seed:dev:admin
// (that script already sets is_active: true on the AdminUser again).

import {
  EmployeeStatus,
  EmploymentType,
  Gender,
  MaritalStatus,
  PersonType,
  Religion,
} from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";

const TARGET_EMAIL = process.env.DEV_ADMIN_EMAIL;
// Deliberately NOT "99.99.xxx" - that prefix is the test-data convention
// EmployeeTest.delete() blanket-deletes on every test run (see
// src/test/test-utils.ts). This employee needs to survive `bun test`.
const EMPLOYEE_ID = "12.01.999";

async function main() {
  if (!TARGET_EMAIL) {
    throw new Error("DEV_ADMIN_EMAIL is not set — check server/.env");
  }

  const [unit, position, level, building] = await Promise.all([
    prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Directorate" },
    }),
    prismaClient.masterJobPosition.findUniqueOrThrow({
      where: { name: "Junior Full Stack Web Developer" },
    }),
    prismaClient.masterJobLevel.findUniqueOrThrow({
      where: { name: "Staff" },
    }),
    prismaClient.masterBuilding.findUniqueOrThrow({
      where: { name: "Elementary" },
    }),
  ]);

  let person = await prismaClient.person.findUnique({
    where: { email: TARGET_EMAIL },
    include: { employee: true },
  });

  if (!person) {
    const displayName = TARGET_EMAIL.split("@")[0];
    person = await prismaClient.person.create({
      data: {
        full_name: displayName,
        nick_name: displayName,
        email: TARGET_EMAIL,
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
            building_id: building.id,
            join_date: new Date("2026-01-01"),
            marital_status: MaritalStatus.SINGLE,
          },
        },
      },
      include: { employee: true },
    });
    console.log("Employee created:", person.email);
  } else {
    console.log("Employee already exists:", person.email);
  }

  const deactivatedAdmin = await prismaClient.adminUser.updateMany({
    where: { email: TARGET_EMAIL },
    data: { is_active: false },
  });

  console.log(`\nSuccess`);
  console.log(`-------------------------------------`);
  console.log(`Employee ID : ${person.employee!.employee_id}`);
  console.log(`Email       : ${person.email}`);
  console.log(`Unit        : ${unit.name}`);
  console.log(`Job Position: ${position.name}`);
  console.log(`Job Level   : ${level.name}`);
  console.log(`Building    : ${building.name}`);
  console.log(
    `Admin deactivated: ${deactivatedAdmin.count > 0 ? "yes" : "no matching AdminUser found"}`,
  );
  console.log(`-------------------------------------`);
  console.log(`\nSwitch back to admin testing with: bun run seed:dev:admin`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
