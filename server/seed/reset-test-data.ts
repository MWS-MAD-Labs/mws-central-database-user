// Usage:
//   bun run reset:test-data
//
// Full reset of everything created by manual/frontend testing (Person and
// its dependents: Student, Employee, health/consent/parent-guardian
// records, enrollments; plus ApiClient and AdminUser). Master data
// (MasterUnit, MasterJobPosition, MasterJobLevel, ApiScope) is left
// untouched on purpose — that's reference config, not test noise.
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
  await prismaClient.classHomeroomAssignment.deleteMany({});

  const students = await prismaClient.student.deleteMany({});
  const employees = await prismaClient.employee.deleteMany({});
  const persons = await prismaClient.person.deleteMany({});
  const apiClients = await prismaClient.apiClient.deleteMany({});
  const adminUsers = await prismaClient.adminUser.deleteMany({});

  console.log("Reset complete:");
  console.log(`  students:    ${students.count}`);
  console.log(`  employees:   ${employees.count}`);
  console.log(`  persons:     ${persons.count}`);
  console.log(`  api clients: ${apiClients.count}`);
  console.log(`  admin users: ${adminUsers.count}`);
  console.log(
    "Master data (units, job positions, job levels, api scopes) left untouched.",
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
