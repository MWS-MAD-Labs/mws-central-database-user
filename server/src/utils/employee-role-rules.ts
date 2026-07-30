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

export function assertJobPositionJobLevelCompatible(
  jobPositionName: string,
  isTeachingPosition: boolean,
  jobLevelName: string,
  isTeachingRole: boolean,
): void {
  if (isTeachingPosition !== isTeachingRole) {
    throw new ResponseError(
      400,
      `Job position "${jobPositionName}" (${isTeachingPosition ? "teaching" : "non-teaching"}) is not compatible with job level "${jobLevelName}" (${isTeachingRole ? "teaching" : "non-teaching"})`,
    );
  }
}

export async function assertJobPositionJobLevelCompatibleByIds(
  jobPositionId: string,
  jobLevelId: string,
): Promise<void> {
  const [jobPosition, jobLevel] = await Promise.all([
    prismaClient.masterJobPosition.findUnique({ where: { id: jobPositionId } }),
    prismaClient.masterJobLevel.findUnique({ where: { id: jobLevelId } }),
  ]);

  // Missing job position/level is a different problem (bad FK), handled elsewhere.
  if (!jobPosition || !jobLevel) return;

  assertJobPositionJobLevelCompatible(
    jobPosition.name,
    jobPosition.is_teaching_position,
    jobLevel.name,
    jobLevel.is_teaching_role,
  );
}
