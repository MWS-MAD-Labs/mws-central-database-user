// This deletes grades. Run `bun run seed:master-lists` before tests.

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

  // Restricted child rows must be deleted before students and employees.
  await prismaClient.studentMutationHistory.deleteMany({});
  await prismaClient.disciplinaryActionAttachment.deleteMany({});
  await prismaClient.employeeDisciplinaryAction.deleteMany({});
  await prismaClient.employeeMutationHistory.deleteMany({});

  const students = await prismaClient.student.deleteMany({});
  const employees = await prismaClient.employee.deleteMany({});
  const persons = await prismaClient.person.deleteMany({});
  const apiClients = await prismaClient.apiClient.deleteMany({});
  const adminUsers = await prismaClient.adminUser.deleteMany({});

  // Delete master data after its employee and admin references.
  const apiScopes = await prismaClient.apiScope.deleteMany({});
  const units = await prismaClient.masterUnit.deleteMany({});
  const jobPositions = await prismaClient.masterJobPosition.deleteMany({});
  const jobLevels = await prismaClient.masterJobLevel.deleteMany({});
  const buildings = await prismaClient.masterBuilding.deleteMany({});

  // Classes reference grades and academic years.
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
