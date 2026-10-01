// Run with --clean before tests to avoid fixture collisions.

import {
  AcademicYearStatus,
  ClassStatus,
  ClassTeacherRole,
  EmployeeStatus,
  EmploymentType,
  EnrollmentStatus,
  Gender,
  MaritalStatus,
  PersonType,
  Religion,
  StudentEntryType,
  StudentStatus,
  StudentSupportRole,
} from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";
import { generateNis } from "../src/utils/nis-generator";

const NOW_YEAR = new Date().getFullYear();

// Use valid synthetic year names that cannot collide with school data.
const SANDBOX_YEAR = 9000;
const PAST_YEAR_NAME = `${SANDBOX_YEAR - 2}/${SANDBOX_YEAR - 1}`;
const CURRENT_YEAR_NAME = `${SANDBOX_YEAR}/${SANDBOX_YEAR + 1}`;
const NEXT_YEAR_NAME = `${SANDBOX_YEAR + 1}/${SANDBOX_YEAR + 2}`;

// Test cleanup deletes @millennia21.id accounts.
const EMAIL_DOMAIN = "mws-dev.local";
const STUDENT_EMAIL_PREFIX = "dev.sandbox.student.";

type UnitKey = "Kindergarten" | "Elementary" | "Junior High";
const UNIT_KEYS: UnitKey[] = ["Kindergarten", "Elementary", "Junior High"];

const UNIT_TAG: Record<UnitKey, string> = {
  Kindergarten: "kg",
  Elementary: "el",
  "Junior High": "jh",
};

const UNIT_ENTRY_GRADE: Record<UnitKey, string> = {
  Kindergarten: "Kindergarten Pre-K",
  Elementary: "Grade 1",
  "Junior High": "Grade 7",
};

const UNIT_SECOND_GRADE: Record<UnitKey, string> = {
  Kindergarten: "Kindergarten K1",
  Elementary: "Grade 2",
  "Junior High": "Grade 8",
};

const UNIT_SUBJECT_POSITION: Record<UnitKey, string> = {
  Kindergarten: "Art Teacher",
  Elementary: "Math Teacher",
  "Junior High": "Science Teacher",
};
const UNIT_SUBJECT_NAME: Record<UnitKey, string> = {
  Kindergarten: "Art",
  Elementary: "Math",
  "Junior High": "Science",
};

const UNIT_STAFF_POSITION: Record<UnitKey, string> = {
  Kindergarten: "Staff Admin",
  Elementary: "Librarian",
  "Junior High": "IT Support",
};

const UNIT_STUDENT_BIRTH_YEAR: Record<UnitKey, number> = {
  Kindergarten: NOW_YEAR - 5,
  Elementary: NOW_YEAR - 7,
  "Junior High": NOW_YEAR - 13,
};

function emailFor(tag: string): string {
  return `dev.sandbox.${tag}@${EMAIL_DOMAIN}`;
}

async function clean() {
  const academicYears = await prismaClient.academicYear.findMany({
    where: { name: { in: [PAST_YEAR_NAME, CURRENT_YEAR_NAME, NEXT_YEAR_NAME] } },
  });
  const yearIds = academicYears.map((y) => y.id);

  const classes = await prismaClient.class.findMany({
    where: { academic_year_id: { in: yearIds } },
  });
  const classIds = classes.map((c) => c.id);

  // Clean by person identity because sandbox records can move outside these years.
  const studentPersons = await prismaClient.person.findMany({
    where: { email: { startsWith: STUDENT_EMAIL_PREFIX } },
  });
  const studentIds = (
    await prismaClient.student.findMany({
      where: { person_id: { in: studentPersons.map((p) => p.id) } },
      select: { id: true },
    })
  ).map((s) => s.id);

  const employeePersons = await prismaClient.person.findMany({
    where: {
      email: { startsWith: "dev.sandbox." },
      NOT: { email: { startsWith: STUDENT_EMAIL_PREFIX } },
    },
  });
  const employeeIds = (
    await prismaClient.employee.findMany({
      where: { person_id: { in: employeePersons.map((p) => p.id) } },
      select: { id: true },
    })
  ).map((e) => e.id);

  await prismaClient.classTeacherAssignment.deleteMany({
    where: {
      OR: [{ class_id: { in: classIds } }, { employee_id: { in: employeeIds } }],
    },
  });
  await prismaClient.studentClassEnrollment.deleteMany({
    where: { student_id: { in: studentIds } },
  });
  // Restricted employee references must be removed before employee rows.
  await prismaClient.studentSupportAssignment.deleteMany({
    where: { employee_id: { in: employeeIds } },
  });
  await prismaClient.disciplinaryActionAttachment.deleteMany({
    where: { disciplinary_action: { employee_id: { in: employeeIds } } },
  });
  await prismaClient.employeeDisciplinaryAction.deleteMany({
    where: { employee_id: { in: employeeIds } },
  });
  await prismaClient.studentMutationHistory.deleteMany({
    where: { student_id: { in: studentIds } },
  });
  await prismaClient.employeeMutationHistory.deleteMany({
    where: { employee_id: { in: employeeIds } },
  });
  await prismaClient.student.deleteMany({
    where: { person_id: { in: studentPersons.map((p) => p.id) } },
  });
  await prismaClient.person.deleteMany({
    where: { id: { in: studentPersons.map((p) => p.id) } },
  });
  await prismaClient.employee.deleteMany({
    where: { person_id: { in: employeePersons.map((p) => p.id) } },
  });
  await prismaClient.person.deleteMany({
    where: { id: { in: employeePersons.map((p) => p.id) } },
  });

  await prismaClient.class.deleteMany({ where: { id: { in: classIds } } });
  await prismaClient.academicYear.deleteMany({ where: { id: { in: yearIds } } });

  console.log("Dev flow-sandbox data removed.");
  console.log(`  academic years: ${yearIds.length}`);
  console.log(`  classes: ${classIds.length}`);
  console.log(`  students: ${studentPersons.length}`);
  console.log(`  employees: ${employeePersons.length}`);
}

// Seed writes bypass the service guard, so derive class status from the year.
function classStatusFor(yearStatus: AcademicYearStatus): ClassStatus {
  switch (yearStatus) {
    case AcademicYearStatus.ACTIVE:
      return ClassStatus.ACTIVE;
    case AcademicYearStatus.COMPLETED:
      return ClassStatus.INACTIVE;
    case AcademicYearStatus.UPCOMING:
      return ClassStatus.UPCOMING;
  }
}

async function upsertAcademicYear(
  name: string,
  status: AcademicYearStatus,
  startDate: Date,
  endDate: Date,
) {
  return prismaClient.academicYear.upsert({
    where: { name },
    update: { status, start_date: startDate, end_date: endDate },
    create: { name, status, start_date: startDate, end_date: endDate },
  });
}

type ClassPair = { A: string; B: string };

async function upsertEmployee(params: {
  tag: string;
  fullName: string;
  employeeId: string;
  unitId: string;
  jobPositionId: string;
  jobLevelId: string;
  buildingId: string;
  gender: Gender;
  birthYear: number;
}) {
  const email = emailFor(params.tag);
  let person = await prismaClient.person.findUnique({
    where: { email },
    include: { employee: true },
  });
  if (!person) {
    person = await prismaClient.person.create({
      data: {
        full_name: params.fullName,
        nick_name: params.fullName.split(" ")[0],
        email,
        person_type: PersonType.EMPLOYEE,
        gender: params.gender,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date(Date.UTC(params.birthYear, 0, 1)),
        employee: {
          create: {
            employee_id: params.employeeId,
            status: EmployeeStatus.ACTIVE,
            employment_type: EmploymentType.PERMANENT,
            unit_id: params.unitId,
            job_position_id: params.jobPositionId,
            job_level_id: params.jobLevelId,
            building_id: params.buildingId,
            join_date: new Date(Date.UTC(NOW_YEAR, 0, 1)),
            marital_status: MaritalStatus.SINGLE,
          },
        },
      },
      include: { employee: true },
    });
  }
  return person.employee!;
}

async function upsertAssignment(
  classId: string,
  employeeId: string,
  role: ClassTeacherRole,
  subject?: string,
) {
  const existing = await prismaClient.classTeacherAssignment.findFirst({
    where: { class_id: classId, employee_id: employeeId, role, deleted_at: null },
  });
  if (existing) return existing;
  return prismaClient.classTeacherAssignment.create({
    data: {
      class_id: classId,
      employee_id: employeeId,
      role,
      subject: subject ?? null,
      start_date: new Date(),
    },
  });
}

async function main() {
  // Preserve any existing active year; upcoming years still support the flow.
  const otherActiveYear = await prismaClient.academicYear.findFirst({
    where: {
      status: AcademicYearStatus.ACTIVE,
      name: { not: CURRENT_YEAR_NAME },
    },
  });
  const currentYearStatus = otherActiveYear
    ? AcademicYearStatus.UPCOMING
    : AcademicYearStatus.ACTIVE;

  // UTC constructors prevent WIB from shifting stored school dates.
  const pastYear = await upsertAcademicYear(
    PAST_YEAR_NAME,
    AcademicYearStatus.COMPLETED,
    new Date(Date.UTC(NOW_YEAR - 2, 6, 1)),
    new Date(Date.UTC(NOW_YEAR - 1, 5, 30)),
  );
  const currentYear = await upsertAcademicYear(
    CURRENT_YEAR_NAME,
    currentYearStatus,
    new Date(Date.UTC(NOW_YEAR, 6, 1)),
    new Date(Date.UTC(NOW_YEAR + 1, 5, 30)),
  );
  const nextYear = await upsertAcademicYear(
    NEXT_YEAR_NAME,
    AcademicYearStatus.UPCOMING,
    new Date(Date.UTC(NOW_YEAR + 1, 6, 1)),
    new Date(Date.UTC(NOW_YEAR + 2, 5, 30)),
  );
  const years = [pastYear, currentYear, nextYear];

  console.log(
    `Academic years: ${PAST_YEAR_NAME} (COMPLETED), ${CURRENT_YEAR_NAME} (${currentYearStatus}), ${NEXT_YEAR_NAME} (UPCOMING)`,
  );
  if (otherActiveYear) {
    console.log(
      `  Note: "${otherActiveYear.name}" is already ACTIVE, so the current sandbox year was kept UPCOMING instead of taking over ACTIVE.`,
    );
  }

  const grades = await prismaClient.grade.findMany({
    where: { unit: { name: { in: UNIT_KEYS } } },
    include: { unit: true },
    orderBy: { level: "asc" },
  });
  if (grades.length === 0) {
    throw new Error(
      "No grades found for Kindergarten/Elementary/Junior High - run `bun run seed:master-lists` first.",
    );
  }

  const classByGradeAndYear = new Map<string, ClassPair>();
  let classCount = 0;
  for (const year of years) {
    const status = classStatusFor(year.status);
    for (const grade of grades) {
      const nameA = `${grade.name} A`;
      const nameB = `${grade.name} B`;

      const classA = await prismaClient.class.upsert({
        where: {
          name_academic_year_id: { name: nameA, academic_year_id: year.id },
        },
        update: { status },
        create: {
          name: nameA,
          grade_id: grade.id,
          academic_year_id: year.id,
          status,
        },
      });
      const classB = await prismaClient.class.upsert({
        where: {
          name_academic_year_id: { name: nameB, academic_year_id: year.id },
        },
        update: { status },
        create: {
          name: nameB,
          grade_id: grade.id,
          academic_year_id: year.id,
          status,
        },
      });
      classByGradeAndYear.set(`${grade.id}:${year.id}`, {
        A: classA.id,
        B: classB.id,
      });
      classCount += 2;
    }
  }
  console.log(
    `Classes: ${classCount} upserted (${grades.length} grades x 2 x ${years.length} years).`,
  );

  const units = {} as Record<UnitKey, { id: string }>;
  const buildings = {} as Record<UnitKey, { id: string }>;
  for (const key of UNIT_KEYS) {
    units[key] = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: key },
    });
    buildings[key] = await prismaClient.masterBuilding.findUniqueOrThrow({
      where: { name: key },
    });
  }

  const homeroomPosition = await prismaClient.masterJobPosition.findUniqueOrThrow(
    { where: { name: "Homeroom Teacher" } },
  );
  const sePosition = await prismaClient.masterJobPosition.findUniqueOrThrow({
    where: { name: "Special Education Teacher" },
  });
  const teacherLevel = await prismaClient.masterJobLevel.findUniqueOrThrow({
    where: { name: "Teacher" },
  });
  const seLevel = await prismaClient.masterJobLevel.findUniqueOrThrow({
    where: { name: "SE Teacher" },
  });
  const staffLevel = await prismaClient.masterJobLevel.findUniqueOrThrow({
    where: { name: "Staff" },
  });

  const homeroomTeachers: Record<UnitKey, { id: string }[]> = {
    Kindergarten: [],
    Elementary: [],
    "Junior High": [],
  };
  const seTeachers = {} as Record<UnitKey, { id: string }>;
  const subjectTeachers = {} as Record<UnitKey, { id: string }>;
  let employeeCount = 0;

  for (const key of UNIT_KEYS) {
    const tag = UNIT_TAG[key];

    for (const n of [1, 2] as const) {
      const emp = await upsertEmployee({
        tag: `homeroom.${tag}.${n}`,
        fullName: `Dev Homeroom Teacher ${key} ${n}`,
        employeeId: `DEV.SB.HR.${tag.toUpperCase()}${n}`,
        unitId: units[key].id,
        jobPositionId: homeroomPosition.id,
        jobLevelId: teacherLevel.id,
        buildingId: buildings[key].id,
        gender: n === 1 ? Gender.FEMALE : Gender.MALE,
        birthYear: 1990,
      });
      homeroomTeachers[key].push(emp);
      employeeCount += 1;
    }

    const subjectPosition = await prismaClient.masterJobPosition.findUniqueOrThrow(
      { where: { name: UNIT_SUBJECT_POSITION[key] } },
    );
    subjectTeachers[key] = await upsertEmployee({
      tag: `subject.${tag}`,
      fullName: `Dev Subject Teacher ${key}`,
      employeeId: `DEV.SB.SJ.${tag.toUpperCase()}`,
      unitId: units[key].id,
      jobPositionId: subjectPosition.id,
      jobLevelId: teacherLevel.id,
      buildingId: buildings[key].id,
      gender: Gender.FEMALE,
      birthYear: 1988,
    });
    employeeCount += 1;

    seTeachers[key] = await upsertEmployee({
      tag: `se.${tag}`,
      fullName: `Dev SE Teacher ${key}`,
      employeeId: `DEV.SB.SE.${tag.toUpperCase()}`,
      unitId: units[key].id,
      jobPositionId: sePosition.id,
      jobLevelId: seLevel.id,
      buildingId: buildings[key].id,
      gender: Gender.MALE,
      birthYear: 1985,
    });
    employeeCount += 1;

    const staffPosition = await prismaClient.masterJobPosition.findUniqueOrThrow(
      { where: { name: UNIT_STAFF_POSITION[key] } },
    );
    await upsertEmployee({
      tag: `staff.${tag}`,
      fullName: `Dev Staff ${key}`,
      employeeId: `DEV.SB.ST.${tag.toUpperCase()}`,
      unitId: units[key].id,
      jobPositionId: staffPosition.id,
      jobLevelId: staffLevel.id,
      buildingId: buildings[key].id,
      gender: Gender.MALE,
      birthYear: 1992,
    });
    employeeCount += 1;
  }
  console.log(
    `Employees: ${employeeCount} upserted (6 homeroom, 3 SE, 3 subject, 3 staff).`,
  );

  let assignmentCount = 0;
  for (const key of UNIT_KEYS) {
    const entryGrade = grades.find((g) => g.name === UNIT_ENTRY_GRADE[key])!;
    const secondGrade = grades.find((g) => g.name === UNIT_SECOND_GRADE[key])!;
    const entryClasses = classByGradeAndYear.get(
      `${entryGrade.id}:${currentYear.id}`,
    )!;
    const secondClasses = classByGradeAndYear.get(
      `${secondGrade.id}:${currentYear.id}`,
    )!;

    await upsertAssignment(
      entryClasses.A,
      homeroomTeachers[key][0].id,
      ClassTeacherRole.HOMEROOM,
    );
    await upsertAssignment(
      secondClasses.A,
      homeroomTeachers[key][1].id,
      ClassTeacherRole.HOMEROOM,
    );
    await upsertAssignment(
      entryClasses.A,
      subjectTeachers[key].id,
      ClassTeacherRole.SUBJECT_TEACHER,
      UNIT_SUBJECT_NAME[key],
    );
    assignmentCount += 3;
  }
  console.log(`Teacher assignments: ${assignmentCount} upserted.`);

  let studentCount = 0;
  for (const key of UNIT_KEYS) {
    const tag = UNIT_TAG[key];
    const entryGrade = grades.find((g) => g.name === UNIT_ENTRY_GRADE[key])!;
    const entryClasses = classByGradeAndYear.get(
      `${entryGrade.id}:${currentYear.id}`,
    )!;

    for (const n of [1, 2] as const) {
      const email = emailFor(`student.${tag}.${n}`);
      const existing = await prismaClient.person.findUnique({
        where: { email },
      });
      if (existing) {
        studentCount += 1;
        continue;
      }

      const nis = await generateNis({
        academicYear: currentYear,
        gradeLevel: entryGrade.level,
        entryType: StudentEntryType.PSB,
      });

      const person = await prismaClient.person.create({
        data: {
          full_name: `Dev Sandbox Student ${key} ${n}`,
          nick_name: `${UNIT_TAG[key].toUpperCase()}${n}`,
          email,
          person_type: PersonType.STUDENT,
          gender: n === 1 ? Gender.FEMALE : Gender.MALE,
          religion: Religion.ISLAM,
          birth_place: "Jakarta",
          birth_date: new Date(Date.UTC(UNIT_STUDENT_BIRTH_YEAR[key], 5, 1)),
          student: {
            create: {
              nis,
              status: StudentStatus.ACTIVE,
              current_grade_id: entryGrade.id,
              current_class_id: entryClasses.A,
              join_academic_year_id: currentYear.id,
              join_grade_id: entryGrade.id,
              entry_type: StudentEntryType.PSB,
            },
          },
        },
        include: { student: true },
      });

      await prismaClient.studentClassEnrollment.create({
        data: {
          student_id: person.student!.id,
          academic_year_id: currentYear.id,
          class_id: entryClasses.A,
          grade_id: entryGrade.id,
          grade_level: entryGrade.name,
          class_name_snapshot: `${entryGrade.name} A`,
          enrollment_status: EnrollmentStatus.ACTIVE,
          start_date: currentYear.start_date,
        },
      });

      // Assign support directly to the first student; leave the second unassigned.
      if (n === 1) {
        await prismaClient.studentSupportAssignment.create({
          data: {
            student_id: person.student!.id,
            employee_id: seTeachers[key].id,
            role: StudentSupportRole.SPECIAL_ED,
          },
        });
      }
      studentCount += 1;
    }
  }
  console.log(
    `Students: ${studentCount} upserted (2 per unit), each enrolled in their unit's entry-grade "A" class for ${CURRENT_YEAR_NAME}.`,
  );

  console.log("\n=== Flow sandbox seed complete ===");
  console.log(
    "Log in as an existing SUPER_ADMIN/DATABASE_ADMIN and open Students/Academic in the UI to try enroll/transfer/promote/graduate against this data.",
  );
  console.log(
    `Empty classes (grade's "B" class, and every class outside the entry/second grade) are deliberately left without students or teachers - use those as promotion/transfer targets.`,
  );
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
