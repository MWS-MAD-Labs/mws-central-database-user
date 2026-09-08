// One-off cleanup: Student.current_class_id is a denormalized FK that's
// supposed to always be created/cleared in lockstep with a real
// StudentClassEnrollment row (see enrollment-service.ts's create/promote/
// transfer/close/remove - every one of those already does both together in
// the same transaction). This script finds students where that pairing has
// drifted - current_class_id points at a class with no matching enrollment
// row at all (not even a soft-deleted one) - and clears it, so
// /api/internal/students' current_class stops reporting a class the
// student was never actually enrolled in (this is what downstream apps
// like MTSS sync from - see mws-mtss-system's mtssStudentRosterSync.js).
//
// Dry-run by default - prints what it would change, writes nothing.
// Pass --apply to actually clear the drifted current_class_id values.
//
// Usage:
//   bun run scripts/reconcile-current-class-id.ts          # dry run
//   bun run scripts/reconcile-current-class-id.ts --apply  # writes

import "dotenv/config";
import { prismaClient } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

async function main() {
  // Not narrowed further here (e.g. "enrollments: none") - a student can
  // have real enrollment history for a *different* class while
  // current_class_id itself still points at one it was never enrolled
  // in, so every non-null current_class_id needs the per-student check
  // below rather than being pre-filtered by relation shape.
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
