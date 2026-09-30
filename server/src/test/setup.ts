import { prismaClient } from "../lib/prisma";

if (process.env.NODE_ENV === "test") {
  const databaseUrl = new URL(process.env.DATABASE_URL || "");
  const databaseName = databaseUrl.pathname.replace(/^\//, "").toLowerCase();
  if (!databaseName.includes("test")) {
    throw new Error(
      `Refusing to run destructive integration-test setup against non-test database "${databaseName}". Set DATABASE_URL to a dedicated test database.`,
    );
  }

  // Integration tests own all transactional data in the test database. Clear
  // residue from interrupted or previous runs while retaining seeded masters.
  await prismaClient.auditLog.deleteMany({});
  await prismaClient.syncLog.deleteMany({});
  await prismaClient.applicationEntitlement.deleteMany({});
  await prismaClient.importJob.deleteMany({});
  await prismaClient.consentAttachment.deleteMany({});
  await prismaClient.consentRecord.deleteMany({});
  await prismaClient.healthRecord.deleteMany({});
  await prismaClient.healthNote.deleteMany({});
  await prismaClient.vaccineRecord.deleteMany({});
  await prismaClient.parentGuardian.deleteMany({});
  await prismaClient.studentSupportAssignment.deleteMany({});
  await prismaClient.passionConnectionActivity.deleteMany({});
  await prismaClient.pcActivityRoom.deleteMany({});
  await prismaClient.classTeacherAssignment.deleteMany({});
  await prismaClient.studentClassEnrollment.deleteMany({});
  await prismaClient.studentMutationHistory.deleteMany({});
  await prismaClient.employeeMutationHistory.deleteMany({});
  await prismaClient.internMutationHistory.deleteMany({});
  await prismaClient.pCActivityMentorMutationHistory.deleteMany({});
  await prismaClient.pCActivityDefaultMentor.deleteMany({});
  await prismaClient.disciplinaryActionAttachment.deleteMany({});
  await prismaClient.employeeDisciplinaryAction.deleteMany({});
  await prismaClient.student.deleteMany({});
  await prismaClient.intern.deleteMany({});
  await prismaClient.employee.deleteMany({});
  await prismaClient.person.deleteMany({});
  await prismaClient.adminUser.deleteMany({});
  await prismaClient.apiClient.deleteMany({});
  await prismaClient.class.deleteMany({});
  await prismaClient.academicYear.deleteMany({});
}
