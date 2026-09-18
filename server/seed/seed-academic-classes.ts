// Seed historical years only outside test databases; fixture year names collide.

import {
  AcademicYearStatus,
  ClassStatus,
  type Grade,
} from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";
import { UNKNOWN_LEGACY_GRADE_NAME } from "../src/model/grade-model";

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

const STANDARD_GRADE_LEVELS = [-3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Use Pre-K/K1/K2 labels instead of negative grade levels.
function gradeLabel(grade: Grade): string {
  if (grade.level < 0) return grade.name.replace("Kindergarten ", "");
  return String(grade.level);
}

async function main() {
  const grades = await prismaClient.grade.findMany({
    where: {
      name: { not: UNKNOWN_LEGACY_GRADE_NAME },
      level: { in: STANDARD_GRADE_LEVELS },
    },
    orderBy: { level: "asc" },
  });

  if (grades.length !== STANDARD_GRADE_LEVELS.length) {
    const foundLevels = new Set(grades.map((grade) => grade.level));
    const missingLevels = STANDARD_GRADE_LEVELS.filter(
      (level) => !foundLevels.has(level),
    );

    throw new Error(
      `Expected ${STANDARD_GRADE_LEVELS.length} standard grades, found ${grades.length}. Missing level(s): ${missingLevels.join(", ")}. Run \`bun run seed:master-lists\` first.`,
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

    // Seed writes bypass the service guard, so derive status from the year.
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
