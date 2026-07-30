import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";

// Confirmed against 111 real employee rows, zero exceptions: Teacher/SE
// Teacher only appear under these units. Other job levels are unit-agnostic.
const TEACHING_JOB_LEVELS = new Set(["teacher", "se teacher"]);
const SCHOOL_UNITS = new Set(["kindergarten", "elementary", "junior high"]);

export function assertUnitJobLevelCompatible(
  unitName: string,
  jobLevelName: string,
): void {
  if (
    TEACHING_JOB_LEVELS.has(jobLevelName.trim().toLowerCase()) &&
    !SCHOOL_UNITS.has(unitName.trim().toLowerCase())
  ) {
    throw new ResponseError(
      400,
      `Job level "${jobLevelName}" is only valid for Kindergarten, Elementary, or Junior High units (got unit "${unitName}")`,
    );
  }
}

export async function assertUnitJobLevelCompatibleByIds(
  unitId: string,
  jobLevelId: string,
): Promise<void> {
  const [unit, jobLevel] = await Promise.all([
    prismaClient.masterUnit.findUnique({ where: { id: unitId } }),
    prismaClient.masterJobLevel.findUnique({ where: { id: jobLevelId } }),
  ]);

  // Missing unit/job level is a different problem (bad FK), handled elsewhere.
  if (!unit || !jobLevel) return;

  assertUnitJobLevelCompatible(unit.name, jobLevel.name);
}
