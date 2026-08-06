// Usage:
//   bun run seed:academic-classes
//
// Seeds 10 AcademicYears (2018/2019 - 2027/2028, all COMPLETED) and 1 Class
// per Grade per year (12 grades x 10 years = 120 classes), each year with its
// own class-naming theme - matching the real pattern documented in
// academic-class-walkthrough.md ("1 Fuji" etc, themes vary year to year).
//
// These are literal, real academic years - they will collide with
// class.test.ts/academic-year.test.ts's current-year-relative fixture
// naming (year-1/year, year/year+1, year+1/year+2) once seeded. That's a
// known tradeoff of seeding real historical years; those suites should be
// run against a DB without this seed applied, or their fixture-year scheme
// adjusted separately.
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
import { UNKNOWN_LEGACY_GRADE_NAME } from "../src/service/import-service";

const PLANET_THEME = [
  "Mercury",
  "Venus",
  "Earth",
  "Mars",
  "Jupiter",
  "Saturn",
  "Uranus",
  "Neptune",
  "Pluto",
  "Titan",
  "Europa",
  "Callisto",
];

const ANIMAL_THEME = [
  "Lion",
  "Tiger",
  "Bear",
  "Wolf",
  "Fox",
  "Deer",
  "Elephant",
  "Giraffe",
  "Zebra",
  "Panda",
  "Koala",
  "Kangaroo",
];

const RIVER_THEME = [
  "Nile",
  "Amazon",
  "Yangtze",
  "Mississippi",
  "Danube",
  "Ganges",
  "Mekong",
  "Volga",
  "Thames",
  "Rhine",
  "Congo",
  "Zambezi",
];

const TREE_THEME = [
  "Oak",
  "Maple",
  "Cedar",
  "Birch",
  "Willow",
  "Pine",
  "Teak",
  "Mahogany",
  "Bamboo",
  "Sakura",
  "Baobab",
  "Redwood",
];

const BIRD_THEME = [
  "Eagle",
  "Falcon",
  "Sparrow",
  "Robin",
  "Heron",
  "Swan",
  "Kingfisher",
  "Owl",
  "Peacock",
  "Hummingbird",
  "Crane",
  "Swallow",
];

const GEMSTONE_THEME = [
  "Ruby",
  "Sapphire",
  "Emerald",
  "Amethyst",
  "Topaz",
  "Opal",
  "Garnet",
  "Jade",
  "Pearl",
  "Aquamarine",
  "Citrine",
  "Diamond",
];

const COLOR_THEME = [
  "Crimson",
  "Azure",
  "Amber",
  "Cobalt",
  "Violet",
  "Coral",
  "Indigo",
  "Gold",
  "Silver",
  "Turquoise",
  "Magenta",
  "Scarlet",
];

const CONSTELLATION_THEME = [
  "Orion",
  "Draco",
  "Lyra",
  "Cygnus",
  "Phoenix",
  "Aquila",
  "Perseus",
  "Andromeda",
  "Cassiopeia",
  "Pegasus",
  "Centaurus",
  "Hydra",
];

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
  startDate: Date;
  endDate: Date;
}> = [
  {
    name: "2018/2019",
    status: AcademicYearStatus.COMPLETED,
    theme: PLANET_THEME,
    startDate: new Date(2018, 5, 1),
    endDate: new Date(2019, 5, 1),
  },
  {
    name: "2019/2020",
    status: AcademicYearStatus.COMPLETED,
    theme: ANIMAL_THEME,
    startDate: new Date(2019, 5, 1),
    endDate: new Date(2020, 5, 1),
  },
  {
    name: "2020/2021",
    status: AcademicYearStatus.COMPLETED,
    theme: RIVER_THEME,
    startDate: new Date(2020, 5, 1),
    endDate: new Date(2021, 5, 1),
  },
  {
    name: "2021/2022",
    status: AcademicYearStatus.COMPLETED,
    theme: TREE_THEME,
    startDate: new Date(2021, 5, 1),
    endDate: new Date(2022, 5, 1),
  },
  {
    name: "2022/2023",
    status: AcademicYearStatus.COMPLETED,
    theme: BIRD_THEME,
    startDate: new Date(2022, 5, 1),
    endDate: new Date(2023, 5, 1),
  },
  {
    name: "2023/2024",
    status: AcademicYearStatus.COMPLETED,
    theme: GEMSTONE_THEME,
    startDate: new Date(2023, 5, 1),
    endDate: new Date(2024, 5, 1),
  },
  {
    name: "2024/2025",
    status: AcademicYearStatus.COMPLETED,
    theme: COLOR_THEME,
    startDate: new Date(2024, 5, 1),
    endDate: new Date(2025, 5, 1),
  },
  {
    name: "2025/2026",
    status: AcademicYearStatus.COMPLETED,
    theme: CONSTELLATION_THEME,
    startDate: new Date(2025, 5, 1),
    endDate: new Date(2026, 5, 1),
  },
  {
    name: "2026/2027",
    status: AcademicYearStatus.COMPLETED,
    theme: MOUNTAIN_THEME,
    startDate: new Date(2026, 5, 30),
    endDate: new Date(2027, 5, 29),
  },
  {
    name: "2027/2028",
    status: AcademicYearStatus.COMPLETED,
    theme: FLOWER_THEME,
    startDate: new Date(2027, 5, 30),
    endDate: new Date(2028, 5, 29),
  },
];

// "-3"/"-2"/"-1" reads badly as a class label - use the grade's own short
// form (Pre-K/K1/K2) instead, and the plain level number for Grade 1-9,
// matching the "1 Fuji" convention from the walkthrough.
function gradeLabel(grade: Grade): string {
  if (grade.level < 0) return grade.name.replace("Kindergarten ", "");
  return String(grade.level);
}

async function main() {
  // Excludes the sentinel grade import-service.ts auto-provisions for
  // GRADUATED legacy rows with no Current Grade/Graduation Grade on file -
  // it's not a real grade level and must never get an academic-year class.
  const grades = await prismaClient.grade.findMany({
    where: { name: { not: UNKNOWN_LEGACY_GRADE_NAME } },
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
      update: {
        status: year.status,
        start_date: year.startDate,
        end_date: year.endDate,
      },
      create: {
        name: year.name,
        status: year.status,
        start_date: year.startDate,
        end_date: year.endDate,
      },
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
