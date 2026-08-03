// Usage:
//   bun run seed:academic-classes
//
// Seeds 2 AcademicYears and 1 Class per Grade per year (12 grades x 2 years
// = 24 classes), each year with its own class-naming theme - matching the
// real pattern documented in academic-class-walkthrough.md ("1 Fuji" etc,
// themes vary year to year). Year 1 ("Mountain") is COMPLETED, year 2
// ("Flower") is UPCOMING - never ACTIVE, so this can't collide with the
// single-active-academic-year constraint no matter what's already in the DB.
//
// Requires the 12 grades from migration 20260718024048_seed_grade_master_data
// to already exist. Safe to re-run - academic years are upserted by name,
// classes by (name, academic_year_id).

import {
  AcademicYearStatus,
  ClassStatus,
  type Grade,
} from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";

const MOUNTAIN_THEME = [
  "Everest",
  "Kilimanjaro",
  "Elbrus",
  "Denali",
  "Kosciuszko",
  "Vinson",
  "Matterhorn",
  "Fuji",
  "Rinjani",
  "Bromo",
  "Semeru",
  "Kerinci",
];

const FLOWER_THEME = [
  "Rose",
  "Tulip",
  "Lily",
  "Orchid",
  "Sunflower",
  "Daisy",
  "Jasmine",
  "Lotus",
  "Iris",
  "Peony",
  "Marigold",
  "Lavender",
];

const YEARS: Array<{
  name: string;
  status: AcademicYearStatus;
  theme: string[];
}> = [
  { name: "2026/2027", status: AcademicYearStatus.COMPLETED, theme: MOUNTAIN_THEME },
  { name: "2027/2028", status: AcademicYearStatus.UPCOMING, theme: FLOWER_THEME },
];

// "-3"/"-2"/"-1" reads badly as a class label - use the grade's own short
// form (Pre-K/K1/K2) instead, and the plain level number for Grade 1-9,
// matching the "1 Fuji" convention from the walkthrough.
function gradeLabel(grade: Grade): string {
  if (grade.level < 0) return grade.name.replace("Kindergarten ", "");
  return String(grade.level);
}

async function main() {
  const grades = await prismaClient.grade.findMany({
    orderBy: { level: "asc" },
  });

  if (grades.length !== 12) {
    throw new Error(
      `Expected 12 grades (migration 20260718024048_seed_grade_master_data), found ${grades.length}. Run \`bunx prisma migrate deploy\` first.`,
    );
  }

  let classesCreated = 0;

  for (const year of YEARS) {
    const academicYear = await prismaClient.academicYear.upsert({
      where: { name: year.name },
      update: { status: year.status },
      create: { name: year.name, status: year.status },
    });

    // Class status must follow its academic year - see
    // class-service.ts's assertClassStatusMatchesAcademicYear. This upsert
    // bypasses that service-level guard, so it has to apply the same rule
    // itself.
    const classStatus =
      academicYear.status === AcademicYearStatus.ACTIVE
        ? ClassStatus.ACTIVE
        : ClassStatus.INACTIVE;

    for (const [index, grade] of grades.entries()) {
      const name = `${gradeLabel(grade)} ${year.theme[index]}`;

      await prismaClient.class.upsert({
        where: {
          name_academic_year_id: {
            name,
            academic_year_id: academicYear.id,
          },
        },
        update: { status: classStatus },
        create: {
          name,
          grade_id: grade.id,
          academic_year_id: academicYear.id,
          status: classStatus,
        },
      });
      classesCreated += 1;
    }

    console.log(
      `Academic year ${academicYear.name} (${academicYear.status}): ${grades.length} classes upserted.`,
    );
  }

  console.log(
    `\nDone. ${YEARS.length} academic years, ${classesCreated} classes total.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
