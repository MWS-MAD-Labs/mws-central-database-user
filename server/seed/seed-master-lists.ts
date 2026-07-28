// Usage:
//   bun run seed:master-lists
//
// Seeds MasterJobPosition, MasterJobLevel, and MasterBuilding with the real
// (deduplicated) values from the current employee roster, so testing/admin
// work doesn't require typing them in by hand one at a time.
//
// Safe to re-run - every row is an upsert by name.

import { prismaClient } from "../src/lib/prisma";

const JOB_POSITIONS = [
  "Academic Director",
  "Admin Pelangi / Secretary",
  "Art Teacher",
  "Coding Teacher",
  "Design & Social Media",
  "Director Secretary",
  "Driver",
  "English Teacher",
  "Head of CARE",
  "Head of IT",
  "Head of Operational",
  "Head of Pelangi",
  "Head of SAFE",
  "Homeroom Teacher",
  "IT Support",
  "Integral & Math Teacher",
  "Junior Full Stack Web Developer",
  "Librarian",
  "Makerspace Teacher",
  "Math Teacher",
  "Music Teacher",
  "Office Boy",
  "Office Girl",
  "PLH",
  "Performing Art Teacher",
  "Physical Education Teacher",
  "Principal of Elementary",
  "Principal of Junior High",
  "Principal of Kindergarten",
  "School's Nurse",
  "School's Psychologist",
  "Science Teacher",
  "Secretary",
  "Special Education Teacher",
  "Staff Admin",
  "Staff CARE",
  "Staff COMPASS",
  "Staff Resources",
  "Staff SAFE",
  "Training Development",
];

// Teacher / SE Teacher count as teaching roles - drives job-level-based
// checks elsewhere (e.g. homeroom teacher assignment eligibility).
const JOB_LEVELS: Array<{ name: string; is_teaching_role: boolean }> = [
  { name: "Director", is_teaching_role: false },
  { name: "Head Unit", is_teaching_role: false },
  { name: "SE Teacher", is_teaching_role: true },
  { name: "Staff", is_teaching_role: false },
  { name: "Support Staff", is_teaching_role: false },
  { name: "Teacher", is_teaching_role: true },
];

const BUILDINGS = ["Elementary", "Junior High", "Kindergarten"];

async function main() {
  for (const name of JOB_POSITIONS) {
    await prismaClient.masterJobPosition.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Job positions: ${JOB_POSITIONS.length} upserted.`);

  for (const level of JOB_LEVELS) {
    await prismaClient.masterJobLevel.upsert({
      where: { name: level.name },
      update: { is_teaching_role: level.is_teaching_role },
      create: level,
    });
  }
  console.log(`Job levels: ${JOB_LEVELS.length} upserted.`);

  for (const name of BUILDINGS) {
    await prismaClient.masterBuilding.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Buildings: ${BUILDINGS.length} upserted.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
