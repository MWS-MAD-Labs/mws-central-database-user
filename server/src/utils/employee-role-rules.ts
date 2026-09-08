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

// "Special Education Teacher" is structurally its own thing, not a regular
// classroom subject - it's the only position that pairs with the "SE
// Teacher" level, and "SE Teacher" is the only level it pairs with. Every
// other teaching position (Homeroom Teacher, Math Teacher, ...) pairs with
// the plain "Teacher" level instead. Confirmed against real employee data,
// same basis as TEACHING_JOB_LEVELS/SCHOOL_UNITS above.
const SPECIAL_EDUCATION_POSITION_NAME = "special education teacher";
const SPECIAL_EDUCATION_LEVEL_NAME = "se teacher";

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

  const isSePosition =
    jobPositionName.trim().toLowerCase() === SPECIAL_EDUCATION_POSITION_NAME;
  const isSeLevel =
    jobLevelName.trim().toLowerCase() === SPECIAL_EDUCATION_LEVEL_NAME;
  if (isSePosition !== isSeLevel) {
    throw new ResponseError(
      400,
      `Job position "${jobPositionName}" and job level "${jobLevelName}" must be paired together - "Special Education Teacher" only pairs with the "SE Teacher" level, and vice versa.`,
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

// Most job positions are unit-agnostic (Driver, Librarian, Secretary, ...) -
// only some are genuinely scoped to one unit (e.g. "Head of CARE" only
// makes sense under CARE, confirmed with the user 2026-09-08 for the
// positions that don't literally contain a unit name in their title). See
// MasterJobPosition.unit_id in schema.prisma.
export function assertJobPositionUnitCompatible(
  jobPositionName: string,
  jobPositionUnitName: string | null,
  employeeUnitName: string,
): void {
  if (jobPositionUnitName === null) return;
  if (jobPositionUnitName !== employeeUnitName) {
    throw new ResponseError(
      400,
      `Job position "${jobPositionName}" is only valid for the "${jobPositionUnitName}" unit (got unit "${employeeUnitName}")`,
    );
  }
}

export async function assertJobPositionUnitCompatibleByIds(
  jobPositionId: string,
  unitId: string,
): Promise<void> {
  const [jobPosition, unit] = await Promise.all([
    prismaClient.masterJobPosition.findUnique({
      where: { id: jobPositionId },
      include: { unit: true },
    }),
    prismaClient.masterUnit.findUnique({ where: { id: unitId } }),
  ]);

  // Missing job position/unit is a different problem (bad FK), handled elsewhere.
  if (!jobPosition || !unit) return;

  assertJobPositionUnitCompatible(
    jobPosition.name,
    jobPosition.unit?.name ?? null,
    unit.name,
  );
}
