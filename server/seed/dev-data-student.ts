// Usage:
//   bun run seed:dev:student          seed
//   bun run seed:dev:student:clean    remove everything this script created
//
// Covers Student + every relation: Parent/Guardian, Consent, Health
// Record/Note, Vaccine Record, PC Activity, plus its own dedicated
// Grade/Class/AcademicYear and a teacher employee for the PC Activity
// mentor. Self-contained, doesn't require seed:dev:employee or
// seed:dev:academic to have run first.
//
// SEED_BASE_URL (optional): base URL used only for the printed curl
// examples. Defaults to http://localhost:3000.
//
// IMPORTANT: run --clean before `bun test`.

import { sign } from "hono/jwt";
import {
  AcademicYearStatus,
  AdminRole,
  ConsentStatus,
  ConsentType,
  EmployeeStatus,
  EmploymentType,
  Gender,
  HealthNoteCategory,
  HealthNoteStatus,
  MaritalStatus,
  ParentType,
  PCDay,
  PersonType,
  Religion,
  StudentStatus,
  VaccineType,
} from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24;

// Not @millennia21.id - test cleanup mass-deletes that domain, would wipe seed data
const UNIT_NAME = "DEV_STUDENT_UNIT";
const POSITION_NAME = "DEV_STUDENT_POSITION";
const TEACHER_LEVEL_NAME = "DEV_STUDENT_TEACHER_LEVEL";
const GRADE_NAME = "DEV_STUDENT_GRADE";
const GRADE_LEVEL = 9301;
const ACADEMIC_YEAR_NAME = "Dev Student Academic Year 2026/2027";
const CLASS_NAME = "DEV_STUDENT_CLASS_A";

const ADMIN_EMAIL = "dev.student.superadmin@mws-dev.local";
const DB_ADMIN_EMAIL = "dev.student.dbadmin@mws-dev.local";
const VIEWER_EMAIL = "dev.student.viewer@mws-dev.local";
const VIEWER_SENSITIVE_EMAIL = "dev.student.viewer.sensitive@mws-dev.local";
const TEACHER_EMAIL = "dev.student.teacher@mws-dev.local";
const TEACHER_EMPLOYEE_ID = "DEV.STU01";

const STUDENT_EMAIL = "dev.student@mws-dev.local";
const STUDENT_NIS = "9990001";
const STUDENT_NISN = "9990000001";

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
  const grade = await prismaClient.grade.findUnique({
    where: { name: GRADE_NAME },
  });
  const academicYear = await prismaClient.academicYear.findUnique({
    where: { name: ACADEMIC_YEAR_NAME },
  });

  // Not just the one seeded student by exact email - the walkthrough's own
  // "create a student" demo (section 1) creates extra students against
  // this same Grade/AcademicYear, and those would block deleting them below.
  const students = await prismaClient.student.findMany({
    where: {
      OR: [
        grade ? { current_grade_id: grade.id } : undefined,
        grade ? { join_grade_id: grade.id } : undefined,
        academicYear ? { join_academic_year_id: academicYear.id } : undefined,
      ].filter((c): c is NonNullable<typeof c> => Boolean(c)),
    },
    select: { id: true, person_id: true },
  });

  for (const student of students) {
    // Children first - student_id FKs are ON DELETE RESTRICT.
    await prismaClient.consentAttachment.deleteMany({
      where: { consent: { student_id: student.id } },
    });
    await prismaClient.consentRecord.deleteMany({
      where: { student_id: student.id },
    });
    await prismaClient.parentGuardian.deleteMany({
      where: { student_id: student.id },
    });
    await prismaClient.healthNote.deleteMany({
      where: { student_id: student.id },
    });
    await prismaClient.healthRecord.deleteMany({
      where: { student_id: student.id },
    });
    await prismaClient.vaccineRecord.deleteMany({
      where: { student_id: student.id },
    });
    await prismaClient.passionConnectionActivity.deleteMany({
      where: { student_id: student.id },
    });
    await prismaClient.studentClassEnrollment.deleteMany({
      where: { student_id: student.id },
    });

    await prismaClient.student.delete({ where: { id: student.id } });
    await prismaClient.person.delete({ where: { id: student.person_id } });
  }

  await prismaClient.class.deleteMany({ where: { name: CLASS_NAME } });
  await prismaClient.academicYear.deleteMany({
    where: { name: ACADEMIC_YEAR_NAME },
  });
  await prismaClient.grade.deleteMany({ where: { name: GRADE_NAME } });

  const teacherPerson = await prismaClient.person.findUnique({
    where: { email: TEACHER_EMAIL },
  });
  if (teacherPerson) {
    await prismaClient.employee.deleteMany({
      where: { person_id: teacherPerson.id },
    });
    await prismaClient.person.delete({ where: { id: teacherPerson.id } });
  }

  await prismaClient.adminUser.deleteMany({
    where: {
      email: {
        in: [ADMIN_EMAIL, DB_ADMIN_EMAIL, VIEWER_EMAIL, VIEWER_SENSITIVE_EMAIL],
      },
    },
  });

  await prismaClient.masterJobLevel.deleteMany({
    where: { name: TEACHER_LEVEL_NAME },
  });
  await prismaClient.masterJobPosition.deleteMany({
    where: { name: POSITION_NAME },
  });
  await prismaClient.masterUnit.deleteMany({ where: { name: UNIT_NAME } });

  console.log("Dev student seed data removed.");
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

  const admin = await prismaClient.adminUser.upsert({
    where: { email: ADMIN_EMAIL },
    update: { is_active: true, role: AdminRole.SUPER_ADMIN, unit_id: unit.id },
    create: {
      email: ADMIN_EMAIL,
      full_name: "Dev Student Super Admin",
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
      can_write_data: true,
    },
    create: {
      email: DB_ADMIN_EMAIL,
      full_name: "Dev Student Database Admin",
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

  // can_view_sensitive_data stays false - parent contact / health data
  // comes back undefined for this one.
  const viewer = await prismaClient.adminUser.upsert({
    where: { email: VIEWER_EMAIL },
    update: { is_active: true, role: AdminRole.VIEWER, unit_id: unit.id },
    create: {
      email: VIEWER_EMAIL,
      full_name: "Dev Student Viewer",
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

  // Same role, can_view_sensitive_data: true. No API grants this flag
  // (unlike can_write_data), so it's set directly here.
  const viewerSensitive = await prismaClient.adminUser.upsert({
    where: { email: VIEWER_SENSITIVE_EMAIL },
    update: {
      is_active: true,
      role: AdminRole.VIEWER,
      unit_id: unit.id,
      can_view_sensitive_data: true,
    },
    create: {
      email: VIEWER_SENSITIVE_EMAIL,
      full_name: "Dev Student Viewer (sensitive access granted)",
      role: AdminRole.VIEWER,
      unit_id: unit.id,
      can_view_sensitive_data: true,
      is_active: true,
    },
  });
  const viewerSensitiveAccessToken = await signAccessToken({
    id: viewerSensitive.id,
    email: viewerSensitive.email,
    role: viewerSensitive.role,
  });

  let teacherPerson = await prismaClient.person.findUnique({
    where: { email: TEACHER_EMAIL },
    include: { employee: true },
  });
  if (!teacherPerson) {
    teacherPerson = await prismaClient.person.create({
      data: {
        full_name: "Dev Student Teacher",
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

  const grade = await prismaClient.grade.upsert({
    where: { name: GRADE_NAME },
    update: {},
    create: { name: GRADE_NAME, level: GRADE_LEVEL },
  });

  // UPCOMING, not ACTIVE - same as dev-data-academic.ts, avoids the
  // single-active-year constraint. Pass academic_year_id explicitly on
  // calls that would otherwise resolve to "the" active year.
  const academicYear = await prismaClient.academicYear.upsert({
    where: { name: ACADEMIC_YEAR_NAME },
    update: {},
    create: { name: ACADEMIC_YEAR_NAME, status: AcademicYearStatus.UPCOMING },
  });

  const klass = await prismaClient.class.upsert({
    where: {
      name_academic_year_id: {
        name: CLASS_NAME,
        academic_year_id: academicYear.id,
      },
    },
    update: {},
    create: {
      name: CLASS_NAME,
      grade_id: grade.id,
      academic_year_id: academicYear.id,
    },
  });

  let studentPerson = await prismaClient.person.findUnique({
    where: { email: STUDENT_EMAIL },
    include: { student: true },
  });
  if (!studentPerson) {
    studentPerson = await prismaClient.person.create({
      data: {
        full_name: "Seira Nilvalen",
        nick_name: "Seira",
        email: STUDENT_EMAIL,
        person_type: PersonType.STUDENT,
        gender: Gender.FEMALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("2015-06-15"),
        student: {
          create: {
            nis: STUDENT_NIS,
            nisn: STUDENT_NISN,
            status: StudentStatus.ACTIVE,
            current_grade_id: grade.id,
            join_grade_id: grade.id,
            join_academic_year_id: academicYear.id,
            previous_school: "SD Harapan Bangsa",
            pickup_drop_service: true,
            catering_service: true,
          },
        },
      },
      include: { student: true },
    });
  }
  const student = studentPerson.student!;

  await prismaClient.parentGuardian.createMany({
    data: [
      {
        student_id: student.id,
        type: ParentType.FATHER,
        full_name: "Fiel Nilvalen",
        phone: "081234567890",
        email: "fiel.nilvalen@mws-dev.local",
        address: "Jl. Merdeka No. 1, Jakarta",
        is_primary: true,
      },
      {
        student_id: student.id,
        type: ParentType.MOTHER,
        full_name: "Alena Nilvalen",
        phone: "081298765432",
        email: "alena.nilvalen@mws-dev.local",
        address: "Jl. Merdeka No. 1, Jakarta",
        is_primary: false,
      },
    ],
    skipDuplicates: true,
  });

  // (student_id, consent_type) is a partial index in the migration, not a
  // Prisma @@unique, so findFirst + create instead of upsert.
  const hasMediaConsent = await prismaClient.consentRecord.findFirst({
    where: { student_id: student.id, consent_type: ConsentType.MEDIA_CONSENT },
  });
  if (!hasMediaConsent) {
    await prismaClient.consentRecord.create({
      data: {
        student_id: student.id,
        consent_type: ConsentType.MEDIA_CONSENT,
        status: ConsentStatus.SIGNED,
        consent_date: new Date("2026-01-05"),
        signed_by: "Fiel Nilvalen",
      },
    });
  }

  const hasParentConsent = await prismaClient.consentRecord.findFirst({
    where: { student_id: student.id, consent_type: ConsentType.PARENT_CONSENT },
  });
  if (!hasParentConsent) {
    await prismaClient.consentRecord.create({
      data: {
        student_id: student.id,
        consent_type: ConsentType.PARENT_CONSENT,
        status: ConsentStatus.PENDING,
      },
    });
  }

  await prismaClient.healthRecord.upsert({
    where: { student_id: student.id },
    update: {},
    create: {
      student_id: student.id,
      blood_type: "O",
      needs_assistance: false,
    },
  });

  await prismaClient.healthNote.createMany({
    data: [
      {
        student_id: student.id,
        category: HealthNoteCategory.HEALTH_INFO,
        description: "Mild asthma, carries an inhaler",
        status: HealthNoteStatus.ACTIVE,
      },
      {
        student_id: student.id,
        category: HealthNoteCategory.SPECIAL_NEEDS,
        description: "Needs extra time for written exams",
        status: HealthNoteStatus.ACTIVE,
      },
    ],
  });

  // Same story as ConsentRecord above: (student_id, vaccine_type) is a
  // partial index, not a Prisma @@unique, so findFirst + create.
  const hasPolio = await prismaClient.vaccineRecord.findFirst({
    where: { student_id: student.id, vaccine_type: VaccineType.POLIO },
  });
  if (!hasPolio) {
    await prismaClient.vaccineRecord.create({
      data: {
        student_id: student.id,
        vaccine_type: VaccineType.POLIO,
        received: true,
        date: new Date("2016-03-01"),
      },
    });
  }

  const hasCovid1 = await prismaClient.vaccineRecord.findFirst({
    where: { student_id: student.id, vaccine_type: VaccineType.COVID_1 },
  });
  if (!hasCovid1) {
    await prismaClient.vaccineRecord.create({
      data: {
        student_id: student.id,
        vaccine_type: VaccineType.COVID_1,
        received: false,
      },
    });
  }

  // Same story again: (student_id, day, academic_year_id) is a partial
  // index, not a Prisma @@unique, so findFirst + create.
  const hasMondayPc = await prismaClient.passionConnectionActivity.findFirst({
    where: {
      student_id: student.id,
      day: PCDay.MONDAY,
      academic_year_id: academicYear.id,
    },
  });
  if (!hasMondayPc) {
    await prismaClient.passionConnectionActivity.create({
      data: {
        student_id: student.id,
        day: PCDay.MONDAY,
        activity: "Basketball",
        mentor_id: teacherEmployee.id,
        academic_year_id: academicYear.id,
      },
    });
  }

  const hasTuesdayPc = await prismaClient.passionConnectionActivity.findFirst({
    where: {
      student_id: student.id,
      day: PCDay.TUESDAY,
      academic_year_id: academicYear.id,
    },
  });
  if (!hasTuesdayPc) {
    await prismaClient.passionConnectionActivity.create({
      data: {
        student_id: student.id,
        day: PCDay.TUESDAY,
        activity: "Coding Club",
        academic_year_id: academicYear.id,
      },
    });
  }

  const baseUrl = process.env.SEED_BASE_URL || "http://localhost:3000";

  console.log("\n=== Student seed complete ===");

  console.log(
    "\n--- Copy-paste to set up your shell (matches docs/student-walkthrough.md) ---",
  );
  console.log(`export BASE=${baseUrl}`);
  console.log(`export ADMIN_TOKEN="${adminAccessToken}"`);
  console.log(`export DB_ADMIN_TOKEN="${dbAdminAccessToken}"`);
  console.log(`export VIEWER_TOKEN="${viewerAccessToken}"`);
  console.log(`export VIEWER_SENSITIVE_TOKEN="${viewerSensitiveAccessToken}"`);
  console.log(`export STUDENT_ID=${student.id}`);
  console.log(`export GRADE_ID=${grade.id}`);
  console.log(`export CLASS_ID=${klass.id}`);
  console.log(`export ACADEMIC_YEAR_ID=${academicYear.id}`);
  console.log(`export TEACHER_EMPLOYEE_ID=${teacherEmployee.id}`);

  console.log("\n--- Accounts (all *_TOKEN above expire in 24h) ---");
  console.log(`SUPER_ADMIN               ${admin.email}`);
  console.log(
    `DATABASE_ADMIN            ${dbAdmin.email}  (can_write_data: true)`,
  );
  console.log(
    `VIEWER                    ${viewer.email}  (can_view_sensitive_data: false)`,
  );
  console.log(
    `VIEWER (sensitive)        ${viewerSensitive.email}  (can_view_sensitive_data: true)`,
  );

  console.log("\n--- Seeded records ---");
  console.log(`Student            ${student.nis}  ${studentPerson.email}`);
  console.log(
    `  parents: Fiel Nilvalen (father, primary), Alena Nilvalen (mother)`,
  );
  console.log(
    `  consents: MEDIA_CONSENT (SIGNED), PARENT_CONSENT (PENDING)`,
  );
  console.log(`  health: blood_type O, 1 HEALTH_INFO note, 1 SPECIAL_NEEDS note`);
  console.log(`  vaccines: POLIO (received), COVID_1 (not received)`);
  console.log(
    `  pc activities: MONDAY Basketball (mentor: ${TEACHER_EMPLOYEE_ID}), TUESDAY Coding Club (no mentor)`,
  );
  console.log(
    `  NOT enrolled yet, current_class_id is null, walkthrough demos POST /enrollments live`,
  );
  console.log(
    `Grade/Class/AcademicYear  ${grade.name} / ${klass.name} / ${academicYear.name} (${academicYear.status})`,
  );
  console.log(
    `Teacher employee   ${teacherEmployee.employee_id}  ${teacherPerson.email}  (is_teaching_role: true)`,
  );

  console.log("\n--- Try it (uses the exports above) ---");
  console.log(
    `curl -s -H "Cookie: access_token=$ADMIN_TOKEN" "$BASE/api/admin/students/$STUDENT_ID" | jq .`,
  );
  console.log(
    `curl -s -H "Cookie: access_token=$VIEWER_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/parents" | jq .   # phone/email/address undefined`,
  );
  console.log(
    `curl -s -H "Cookie: access_token=$VIEWER_SENSITIVE_TOKEN" "$BASE/api/admin/students/$STUDENT_ID/parents" | jq .   # phone/email/address visible`,
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
