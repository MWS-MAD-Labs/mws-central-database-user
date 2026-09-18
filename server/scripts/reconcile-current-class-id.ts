// Dry-run by default - prints what it would change, writes nothing.
// Pass --apply to actually clear the drifted current_class_id values.

import "dotenv/config";
import { prismaClient } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

async function main() {
  // Enrollment history for other classes must not hide a drifted current class.
  const candidates = await prismaClient.student.findMany({
    where: { current_class_id: { not: null } },
    select: {
      id: true,
      current_class_id: true,
      person: { select: { full_name: true } },
    },
  });

  const toFix: typeof candidates = [];
  for (const student of candidates) {
    const matchingEnrollment = await prismaClient.studentClassEnrollment.findFirst({
      where: { student_id: student.id, class_id: student.current_class_id! },
      select: { id: true },
    });
    if (!matchingEnrollment) {
      toFix.push(student);
    }
  }

  if (toFix.length === 0) {
    console.log("No drifted current_class_id values found - nothing to do.");
    return;
  }

  console.log(`Found ${toFix.length} student(s) with current_class_id pointing at a class they have no enrollment row for:`);
  for (const student of toFix) {
    console.log(`  - ${student.person.full_name} (student id ${student.id}, current_class_id ${student.current_class_id})`);
  }

  if (!APPLY) {
    console.log("\nDry run only - nothing was changed. Re-run with --apply to clear these.");
    return;
  }

  const result = await prismaClient.student.updateMany({
    where: { id: { in: toFix.map((s) => s.id) } },
    data: { current_class_id: null },
  });
  console.log(`\nCleared current_class_id for ${result.count} student(s).`);
}

main()
  .catch((error) => {
    console.error("reconcile-current-class-id failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
