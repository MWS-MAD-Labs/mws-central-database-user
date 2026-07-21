// Usage:
//   bun run seed/dev-data-academic.ts          seed
//   bun run seed/dev-data-academic.ts --clean  remove everything this script created
//
// Covers the Academic Year / Class / Grade / master-data (Unit, Job
// Position, Job Level)
// SEED_BASE_URL (optional): same meaning as in seed/dev-data-employee.ts —
// base URL used only for the printed curl examples.
//
// IMPORTANT: run --clean before `bun test`.

import { sign } from "hono/jwt";
import {
  AcademicYearStatus,
  AdminRole,
  EmployeeStatus,
  EmploymentType,
  Gender,
  MaritalStatus,
  PersonType,
  Religion,
} from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24;

// Not @millennia21.id - test cleanup mass-deletes that domain, would wipe seed data
const ADMIN_EMAIL = "dev.academic.superadmin@mws-dev.local";
const UNIT_NAME = "DEV_ACADEMIC_UNIT";
const POSITION_NAME = "DEV_ACADEMIC_POSITION";
const TEACHER_LEVEL_NAME = "DEV_ACADEMIC_TEACHER_LEVEL";
const STAFF_LEVEL_NAME = "DEV_ACADEMIC_STAFF_LEVEL";
const TEACHER_EMAIL = "dev.academic.teacher@mws-dev.local";
const TEACHER_EMPLOYEE_ID = "DEV.AC01";
const STAFF_EMAIL = "dev.academic.staff@mws-dev.local";
const STAFF_EMPLOYEE_ID = "DEV.AC02";
const ACADEMIC_YEAR_NAME = "Dev Academic Year 2026/2027";
const DEMO_GRADE_NAME = "Grade 1";

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
  const academicYear = await prismaClient.academicYear.findUnique({
    where: { name: ACADEMIC_YEAR_NAME },
  });

  if (academicYear) {
    await prismaClient.class.deleteMany({
      where: { academic_year_id: academicYear.id },
    });
    await prismaClient.academicYear.delete({ where: { id: academicYear.id } });
  }

  await prismaClient.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });

  const teacherPerson = await prismaClient.person.findUnique({
    where: { email: TEACHER_EMAIL },
  });
  if (teacherPerson) {
    await prismaClient.employee.deleteMany({
      where: { person_id: teacherPerson.id },
    });
    await prismaClient.person.delete({ where: { id: teacherPerson.id } });
  }

  const staffPerson = await prismaClient.person.findUnique({
    where: { email: STAFF_EMAIL },
  });
  if (staffPerson) {
    await prismaClient.employee.deleteMany({
      where: { person_id: staffPerson.id },
    });
    await prismaClient.person.delete({ where: { id: staffPerson.id } });
  }

  await prismaClient.masterJobLevel.deleteMany({
    where: { name: { in: [TEACHER_LEVEL_NAME, STAFF_LEVEL_NAME] } },
  });
  await prismaClient.masterJobPosition.deleteMany({
    where: { name: POSITION_NAME },
  });
  await prismaClient.masterUnit.deleteMany({ where: { name: UNIT_NAME } });

  console.log("Dev academic seed data removed.");
}

async function main() {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set — check server/.env");
  }

  const unit = await prismaClient.masterUnit.upsert({
    where: { name: UNIT_NAME },
    update: {},
    create: { name: UNIT_NAME },
  });

  const position = await prismaClient.masterJobPosition.upsert({
    where: { name: POSITION_NAME },
    update: {},
    create: { name: POSITION_NAME },
  });

  const teacherLevel = await prismaClient.masterJobLevel.upsert({
    where: { name: TEACHER_LEVEL_NAME },
    update: { is_teaching_role: true },
    create: { name: TEACHER_LEVEL_NAME, is_teaching_role: true },
  });

  const staffLevel = await prismaClient.masterJobLevel.upsert({
    where: { name: STAFF_LEVEL_NAME },
    update: { is_teaching_role: false },
    create: { name: STAFF_LEVEL_NAME, is_teaching_role: false },
  });

  const admin = await prismaClient.adminUser.upsert({
    where: { email: ADMIN_EMAIL },
    update: { is_active: true, role: AdminRole.SUPER_ADMIN, unit_id: unit.id },
    create: {
      email: ADMIN_EMAIL,
      full_name: "Dev Academic Super Admin",
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

  let teacherPerson = await prismaClient.person.findUnique({
    where: { email: TEACHER_EMAIL },
    include: { employee: true },
  });
  if (!teacherPerson) {
    teacherPerson = await prismaClient.person.create({
      data: {
        full_name: "Dev Academic Teacher",
        nick_name: "DevTeacher",
        email: TEACHER_EMAIL,
        person_type: PersonType.EMPLOYEE,
        gender: Gender.FEMALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1990-01-01"),
        employee: {
          create: {
            employee_id: TEACHER_EMPLOYEE_ID,
            status: EmployeeStatus.ACTIVE,
            employment_type: EmploymentType.PERMANENT,
            unit_id: unit.id,
            job_position_id: position.id,
            job_level_id: teacherLevel.id,
            building: "Dev Building",
            join_date: new Date("2026-01-01"),
            marital_status: MaritalStatus.SINGLE,
          },
        },
      },
      include: { employee: true },
    });
  }
  const teacherEmployee = teacherPerson.employee!;

  let staffPerson = await prismaClient.person.findUnique({
    where: { email: STAFF_EMAIL },
    include: { employee: true },
  });
  if (!staffPerson) {
    staffPerson = await prismaClient.person.create({
      data: {
        full_name: "Dev Academic Staff",
        nick_name: "DevStaff",
        email: STAFF_EMAIL,
        person_type: PersonType.EMPLOYEE,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Bandung",
        birth_date: new Date("1988-01-01"),
        employee: {
          create: {
            employee_id: STAFF_EMPLOYEE_ID,
            status: EmployeeStatus.ACTIVE,
            employment_type: EmploymentType.PERMANENT,
            unit_id: unit.id,
            job_position_id: position.id,
            job_level_id: staffLevel.id,
            building: "Dev Building",
            join_date: new Date("2026-01-01"),
            marital_status: MaritalStatus.SINGLE,
          },
        },
      },
      include: { employee: true },
    });
  }
  const staffEmployee = staffPerson.employee!;

  // UPCOMING, not ACTIVE — so this never collides with the
  // single-active-academic-year constraint if a real ACTIVE year already
  // exists. The walkthrough demonstrates flipping it to ACTIVE itself.
  const academicYear = await prismaClient.academicYear.upsert({
    where: { name: ACADEMIC_YEAR_NAME },
    update: {},
    create: { name: ACADEMIC_YEAR_NAME, status: AcademicYearStatus.UPCOMING },
  });

  const grade = await prismaClient.grade.findUniqueOrThrow({
    where: { name: DEMO_GRADE_NAME },
  });

  const baseUrl = process.env.SEED_BASE_URL || "http://localhost:3000";

  console.log("\n=== Academic seed complete ===");

  console.log(
    "\n--- Copy-paste to set up your shell (matches docs/academic-class-walkthrough.md) ---",
  );
  console.log(`export BASE=${baseUrl}`);
  console.log(`export ACADEMIC_ADMIN_TOKEN="${adminAccessToken}"`);
  console.log(`export ACADEMIC_UNIT_ID=${unit.id}`);
  console.log(`export ACADEMIC_POSITION_ID=${position.id}`);
  console.log(`export TEACHER_LEVEL_ID=${teacherLevel.id}`);
  console.log(`export STAFF_LEVEL_ID=${staffLevel.id}`);
  console.log(`export TEACHER_EMPLOYEE_ID=${teacherEmployee.id}`);
  console.log(`export STAFF_EMPLOYEE_ID=${staffEmployee.id}`);
  console.log(`export ACADEMIC_YEAR_ID=${academicYear.id}`);
  console.log(`export GRADE_ID=${grade.id}`);

  console.log("\n--- Seeded records ---");
  console.log(`SUPER_ADMIN        ${admin.email}`);
  console.log(
    `Teacher employee   ${teacherEmployee.employee_id}  ${teacherPerson.email}  (job level: ${TEACHER_LEVEL_NAME}, is_teaching_role: true — can be a homeroom teacher)`,
  );
  console.log(
    `Staff employee     ${staffEmployee.employee_id}  ${staffPerson.email}  (job level: ${STAFF_LEVEL_NAME}, is_teaching_role: false — rejected as a homeroom teacher)`,
  );
  console.log(
    `Academic year      ${academicYear.name}  (status: ${academicYear.status})`,
  );
  console.log(`Grade              ${grade.name}  (level: ${grade.level})`);

  console.log("\n--- Try it (uses the exports above) ---");
  console.log(
    `curl -s -X POST -H "Content-Type: application/json" -H "Cookie: access_token=$ACADEMIC_ADMIN_TOKEN" -d '{"name":"1 Fuji","grade_id":"'"$GRADE_ID"'","academic_year_id":"'"$ACADEMIC_YEAR_ID"'","homeroom_teacher_id":"'"$TEACHER_EMPLOYEE_ID"'"}' "$BASE/api/admin/classes" | jq .`,
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
