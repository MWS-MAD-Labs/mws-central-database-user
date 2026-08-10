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

  const students = await prismaClient.student.deleteMany({});

  const persons = await prismaClient.person.deleteMany({
    where: { person_type: "STUDENT" },
  });

  console.log("Student-only reset complete:");
  console.log(`  students deleted:                ${students.count}`);
  console.log(`  persons (type STUDENT) deleted:  ${persons.count}`);
  console.log(
    "  All related student records (health, parents, enrollments) deleted.",
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
