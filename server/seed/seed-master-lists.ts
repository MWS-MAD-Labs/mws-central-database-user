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

// is_teaching_position must agree with whatever job level a position is
// paired with (employee-role-rules.ts's assertJobPositionJobLevelCompatible
// rejects a mismatch) - true here mirrors the same 111 real employee rows
// that rule's "Teacher/SE Teacher" classification was confirmed against.
// Positions not seen in that data (Speech/Occupational Therapist) are kept
// non-teaching - support/therapy roles, not classroom teachers.
const JOB_POSITIONS: Array<{ name: string; is_teaching_position: boolean }> = [
  { name: "Academic Director", is_teaching_position: false },
  { name: "Admin Pelangi / Secretary", is_teaching_position: false },
  { name: "Art Teacher", is_teaching_position: true },
  { name: "Coding Teacher", is_teaching_position: true },
  { name: "Design & Social Media", is_teaching_position: false },
  { name: "Director Secretary", is_teaching_position: false },
  { name: "Driver", is_teaching_position: false },
  { name: "English Teacher", is_teaching_position: true },
  { name: "Head of CARE", is_teaching_position: false },
  { name: "Head of IT", is_teaching_position: false },
  { name: "Head of Operational", is_teaching_position: false },
  { name: "Head of Pelangi", is_teaching_position: false },
  { name: "Head of SAFE", is_teaching_position: false },
  { name: "Homeroom Teacher", is_teaching_position: true },
  { name: "IT Support", is_teaching_position: false },
  { name: "Integral & Math Teacher", is_teaching_position: true },
  { name: "Junior Full Stack Web Developer", is_teaching_position: false },
  { name: "Librarian", is_teaching_position: false },
  { name: "Makerspace Teacher", is_teaching_position: true },
  { name: "Math Teacher", is_teaching_position: true },
  { name: "Music Teacher", is_teaching_position: true },
  { name: "Office Boy", is_teaching_position: false },
  { name: "Office Girl", is_teaching_position: false },
  { name: "PLH", is_teaching_position: false },
  { name: "Performing Art Teacher", is_teaching_position: true },
  { name: "Physical Education Teacher", is_teaching_position: true },
  { name: "Principal of Elementary", is_teaching_position: false },
  { name: "Principal of Junior High", is_teaching_position: false },
  { name: "Principal of Kindergarten", is_teaching_position: false },
  { name: "School's Nurse", is_teaching_position: false },
  { name: "School's Psychologist", is_teaching_position: false },
  { name: "Science Teacher", is_teaching_position: true },
  { name: "Secretary", is_teaching_position: false },
  { name: "Special Education Teacher", is_teaching_position: true },
  { name: "Staff Admin", is_teaching_position: false },
  { name: "Staff CARE", is_teaching_position: false },
  { name: "Staff COMPASS", is_teaching_position: false },
  { name: "Staff Resources", is_teaching_position: false },
  { name: "Staff SAFE", is_teaching_position: false },
  { name: "Training Development", is_teaching_position: false },
  { name: "Speech Therapist", is_teaching_position: false },
  { name: "Occupational Therapist", is_teaching_position: false },
  { name: "Bahasa Indonesia Teacher", is_teaching_position: true },
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

const BUILDINGS = ["Elementary", "Junior High", "Kindergarten", "Outside"];

// Kindergarten sub-levels use negative levels so "Grade N" keeps the simple
// invariant level = N - see migration 20260718024048_seed_grade_master_data.
const GRADES: Array<{ name: string; level: number }> = [
  { name: "Unknown (Legacy Import)", level: -9 },
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

  for (const position of JOB_POSITIONS) {
    await prismaClient.masterJobPosition.upsert({
      where: { name: position.name },
      update: { is_teaching_position: position.is_teaching_position },
      create: position,
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
