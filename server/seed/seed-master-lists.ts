// Usage:
//   bun run seed:master-lists
//
// Seeds MasterUnit, MasterJobPosition, MasterJobLevel, MasterBuilding, and
// Grade with the real (deduplicated) values from the current employee
// roster, so testing/admin work doesn't require typing them in by hand one
// at a time.
//
// Grade is normally seeded once via migration
// 20260718024048_seed_grade_master_data - included here too so it can be
// restored the same way as the other master data after `reset:test-data`.
//
// Safe to re-run - every row is an upsert by name.

import { prismaClient } from "../src/lib/prisma";

const UNITS = [
  "BRIDGE",
  "Kindergarten",
  "Elementary",
  "Pelangi",
  "RISE",
  "SHIELD",
  "SAFE",
  "Junior High",
  "COMPASS",
  "Directorate",
  "MAD Lab",
  "CARE",
];

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
  "Speech Therapist",
  "Occupational Therapist",
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

// Kindergarten sub-levels use negative levels so "Grade N" keeps the simple
// invariant level = N - see migration 20260718024048_seed_grade_master_data.
const GRADES: Array<{ name: string; level: number }> = [
  { name: "Kindergarten Pre-K", level: -3 },
  { name: "Kindergarten K1", level: -2 },
  { name: "Kindergarten K2", level: -1 },
  { name: "Grade 1", level: 1 },
  { name: "Grade 2", level: 2 },
  { name: "Grade 3", level: 3 },
  { name: "Grade 4", level: 4 },
  { name: "Grade 5", level: 5 },
  { name: "Grade 6", level: 6 },
  { name: "Grade 7", level: 7 },
  { name: "Grade 8", level: 8 },
  { name: "Grade 9", level: 9 },
];

async function main() {
  for (const name of UNITS) {
    await prismaClient.masterUnit.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Units: ${UNITS.length} upserted.`);

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

  for (const grade of GRADES) {
    await prismaClient.grade.upsert({
      where: { name: grade.name },
      update: { level: grade.level },
      create: grade,
    });
  }
  console.log(`Grades: ${GRADES.length} upserted.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
