import { prismaClient } from "../src/lib/prisma";
import {
  UNKNOWN_LEGACY_GRADE_LEVEL,
  UNKNOWN_LEGACY_GRADE_NAME,
} from "../src/model/grade-model";

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

// Position and job-level teaching flags must remain compatible.
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

const JOB_LEVELS: Array<{ name: string; is_teaching_role: boolean }> = [
  { name: "Director", is_teaching_role: false },
  { name: "Head Unit", is_teaching_role: false },
  { name: "SE Teacher", is_teaching_role: true },
  { name: "Staff", is_teaching_role: false },
  { name: "Support Staff", is_teaching_role: false },
  { name: "Teacher", is_teaching_role: true },
];

const BUILDINGS = ["Elementary", "Junior High", "Kindergarten", "Outside"];

const PC_ACTIVITIES = [
  "Basketball",
  "Coding Club",
  "Choir and Vocal",
  "Story Telling",
  "Arts and Crafts",
  "Digital Design",
];

// Negative levels reserve positive values for numbered grades.
const GRADES: Array<{
  name: string;
  level: number;
  unitName: string | null;
  typicalAge: number | null;
}> = [
  {
    name: UNKNOWN_LEGACY_GRADE_NAME,
    level: UNKNOWN_LEGACY_GRADE_LEVEL,
    unitName: null,
    typicalAge: null,
  },
  { name: "Kindergarten Pre-K", level: -3, unitName: "Kindergarten", typicalAge: 3 },
  { name: "Kindergarten K1", level: -2, unitName: "Kindergarten", typicalAge: 4 },
  { name: "Kindergarten K2", level: -1, unitName: "Kindergarten", typicalAge: 5 },
  { name: "Grade 1", level: 1, unitName: "Elementary", typicalAge: 6 },
  { name: "Grade 2", level: 2, unitName: "Elementary", typicalAge: 7 },
  { name: "Grade 3", level: 3, unitName: "Elementary", typicalAge: 8 },
  { name: "Grade 4", level: 4, unitName: "Elementary", typicalAge: 9 },
  { name: "Grade 5", level: 5, unitName: "Elementary", typicalAge: 10 },
  { name: "Grade 6", level: 6, unitName: "Elementary", typicalAge: 11 },
  { name: "Grade 7", level: 7, unitName: "Junior High", typicalAge: 12 },
  { name: "Grade 8", level: 8, unitName: "Junior High", typicalAge: 13 },
  { name: "Grade 9", level: 9, unitName: "Junior High", typicalAge: 14 },
];

async function main() {
  await prismaClient.masterUnit.upsert({
    where: { id: "unit_unknown_legacy" },
    update: { name: "Unknown / Legacy" },
    create: { id: "unit_unknown_legacy", name: "Unknown / Legacy" },
  });
  for (const name of UNITS) {
    await prismaClient.masterUnit.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Units: ${UNITS.length + 1} upserted.`);

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

  for (const name of PC_ACTIVITIES) {
    await prismaClient.masterPCActivity.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`PC activities: ${PC_ACTIVITIES.length} upserted.`);

  for (const grade of GRADES) {
    const unit = await prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: grade.unitName ?? "Unknown / Legacy" },
    });
    await prismaClient.grade.upsert({
      where: { name: grade.name },
      update: {
        level: grade.level,
        unit_id: unit.id,
        typical_age: grade.typicalAge,
      },
      create: {
        name: grade.name,
        level: grade.level,
        unit_id: unit.id,
        typical_age: grade.typicalAge,
      },
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
