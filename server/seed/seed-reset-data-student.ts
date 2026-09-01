import { prismaClient } from "../src/lib/prisma";
import { MINIO_BUCKET, minioClient } from "../src/lib/minio";

async function main() {
  // Grab these before the person rows are gone - deleteMany() doesn't
  // return deleted rows, and the object keys aren't derivable afterward.
  const photoObjectKeys = (
    await prismaClient.person.findMany({
      where: { person_type: "STUDENT", photo_object_key: { not: null } },
      select: { photo_object_key: true },
    })
  ).map((person) => person.photo_object_key!);

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

  let photosDeleted = 0;
  for (const objectKey of photoObjectKeys) {
    try {
      await minioClient.removeObject(MINIO_BUCKET, objectKey);
      photosDeleted++;
    } catch (error) {
      console.error(`  failed to delete photo ${objectKey}:`, error);
    }
  }

  console.log("Student-only reset complete:");
  console.log(`  students deleted:                ${students.count}`);
  console.log(`  persons (type STUDENT) deleted:  ${persons.count}`);
  console.log(
    `  MinIO photos deleted:            ${photosDeleted}/${photoObjectKeys.length}`,
  );
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
