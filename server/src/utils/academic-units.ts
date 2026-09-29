import type { Prisma } from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";

export const SYSTEM_ONLY_UNIT_IDS = ["unit_unknown_legacy"] as const;

// PC mentor scopes and PC rooms only accept academic units - the ones that
// actually have grades (Kindergarten/Elementary/Junior High). Staff-only
// units have no students, so a room or mentor scope there is a config error.
export async function assertAcademicUnitIds(
  tx: Prisma.TransactionClient,
  unitIds: string[],
  errorMessage: string,
): Promise<void> {
  const unique = [...new Set(unitIds)];
  if (unique.length === 0) return;
  const unitsWithGrades = await tx.masterUnit.findMany({
    where: { id: { in: unique }, grades: { some: {} } },
    select: { id: true },
  });
  if (unitsWithGrades.length !== unique.length) {
    throw new ResponseError(400, errorMessage);
  }
}

export async function assertOperationalUnitIds(
  tx: Prisma.TransactionClient,
  unitIds: string[],
  errorMessage: string,
): Promise<void> {
  const unique = [...new Set(unitIds)];
  if (unique.length === 0) return;
  const units = await tx.masterUnit.findMany({
    where: {
      id: { in: unique, notIn: [...SYSTEM_ONLY_UNIT_IDS] },
    },
    select: { id: true },
  });
  if (units.length !== unique.length) {
    throw new ResponseError(400, errorMessage);
  }
}
