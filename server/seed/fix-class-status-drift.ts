// Usage:
//   bun run fix:class-status-drift
//
// One-time data fix for classes created before "Class status must follow
// its academic year" was enforced (class-service.ts /
// academic-year-service.ts). Deactivates any class still marked ACTIVE
// whose academic year is UPCOMING or COMPLETED - the same cascade that now
// runs automatically when an academic year leaves ACTIVE, applied
// retroactively to existing data.
//
// Safe to re-run - converges to the same state every time (only touches
// rows currently ACTIVE-but-shouldn't-be).

import { AcademicYearStatus, ClassStatus } from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";

async function main() {
  const result = await prismaClient.class.updateMany({
    where: {
      status: ClassStatus.ACTIVE,
      academic_year: {
        status: { not: AcademicYearStatus.ACTIVE },
      },
    },
    data: { status: ClassStatus.INACTIVE },
  });

  console.log(`Deactivated ${result.count} class(es) whose academic year isn't ACTIVE.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
