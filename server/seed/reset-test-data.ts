// Usage:
//   bun run reset:test-data
//
// Full reset of everything created by manual/frontend testing (Person and
// its dependents: Student, Employee, health/consent/parent-guardian
// records, enrollments; plus ApiClient and AdminUser), the master data
// tables (MasterUnit, MasterJobPosition, MasterJobLevel, MasterBuilding,
// ApiScope) they reference, and the academic structure (Class, Grade,
// AcademicYear).
//
// IMPORTANT: this wipes Grade too, which the test suite assumes always
// exists (it's normally permanent reference data seeded once via migration
// 20260718024048_seed_grade_master_data, not something tests create
// themselves). Run `bun run seed:master-lists` right after this, before
// `bun test` - otherwise every grade/class-dependent test fails on a
// missing grade, not because of anything actually broken.
//
// Run this before `bun test` whenever a prior session (manual testing,
// crashed test runs) may have left real/dev data behind that collides with
// tests assuming an empty Person/ApiClient/AdminUser table.

import { prismaClient } from "../src/lib/prisma";

async function main() {
  await prismaClient.consentAttachment.deleteMany({});
  await prismaClient.consentRecord.deleteMany({});
  await prismaClient.healthRecord.deleteMany({});
  await prismaClient.healthNote.deleteMany({});
  await prismaClient.vaccineRecord.deleteMany({});
  await prismaClient.passionConnectionActivity.deleteMany({});
  await prismaClient.studentClassEnrollment.deleteMany({});
  await prismaClient.parentGuardian.deleteMany({});
  await prismaClient.classTeacherAssignment.deleteMany({});

  const students = await prismaClient.student.deleteMany({});
  const employees = await prismaClient.employee.deleteMany({});
  const persons = await prismaClient.person.deleteMany({});
  const apiClients = await prismaClient.apiClient.deleteMany({});
  const adminUsers = await prismaClient.adminUser.deleteMany({});

  // Master data - safe to delete now that Employee/AdminUser (the only
  // referencing tables) are gone. ApiClientScope rows cascade with ApiScope.
  const apiScopes = await prismaClient.apiScope.deleteMany({});
  const units = await prismaClient.masterUnit.deleteMany({});
  const jobPositions = await prismaClient.masterJobPosition.deleteMany({});
  const jobLevels = await prismaClient.masterJobLevel.deleteMany({});
  const buildings = await prismaClient.masterBuilding.deleteMany({});

  // Academic structure - Class must go before Grade/AcademicYear (its FKs).
  // Student, the only other referencing table, is already gone above.
  const classes = await prismaClient.class.deleteMany({});
  const grades = await prismaClient.grade.deleteMany({});
  const academicYears = await prismaClient.academicYear.deleteMany({});

  console.log("Reset complete:");
  console.log(`  students:       ${students.count}`);
  console.log(`  employees:      ${employees.count}`);
  console.log(`  persons:        ${persons.count}`);
  console.log(`  api clients:    ${apiClients.count}`);
  console.log(`  admin users:    ${adminUsers.count}`);
  console.log(`  api scopes:     ${apiScopes.count}`);
  console.log(`  units:          ${units.count}`);
  console.log(`  job positions:  ${jobPositions.count}`);
  console.log(`  job levels:     ${jobLevels.count}`);
  console.log(`  buildings:      ${buildings.count}`);
  console.log(`  classes:        ${classes.count}`);
  console.log(`  grades:         ${grades.count}`);
  console.log(`  academic years: ${academicYears.count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
