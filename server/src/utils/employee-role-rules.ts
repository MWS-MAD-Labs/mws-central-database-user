import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";
import type { Prisma } from "../generated/prisma/client";

export function assertUnitJobLevelCompatible(
  unitName: string,
  jobLevelName: string,
  allowedUnitNames: string[],
): void {
  if (allowedUnitNames.length === 0) return;

  const normalizedUnit = unitName.trim().toLowerCase();
  const allowed = new Set(
    allowedUnitNames.map((name) => name.trim().toLowerCase()),
  );
  if (!allowed.has(normalizedUnit)) {
    throw new ResponseError(
      400,
      `Job level "${jobLevelName}" is only valid for: ${allowedUnitNames.join(", ")} (got unit "${unitName}")`,
    );
  }
}

export async function assertUnitJobLevelCompatibleByIds(
  unitId: string,
  jobLevelId: string,
): Promise<void> {
  const [unit, jobLevel] = await Promise.all([
    prismaClient.masterUnit.findUnique({ where: { id: unitId } }),
    prismaClient.masterJobLevel.findUnique({
      where: { id: jobLevelId },
      include: { units: { include: { unit: true } } },
    }),
  ]);

  // Missing unit/job level is a different problem (bad FK), handled elsewhere.
  if (!unit || !jobLevel) return;

  assertUnitJobLevelCompatible(
    unit.name,
    jobLevel.name,
    jobLevel.units.map((u) => u.unit.name),
  );
}

// Special Education Teacher pairs only with the SE Teacher level.
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

// Boolean variant for option filtering.
export function jobPositionAndJobLevelAreCompatible(
  jobPositionName: string,
  isTeachingPosition: boolean,
  jobLevelName: string,
  isTeachingRole: boolean,
): boolean {
  try {
    assertJobPositionJobLevelCompatible(
      jobPositionName,
      isTeachingPosition,
      jobLevelName,
      isTeachingRole,
    );
    return true;
  } catch {
    return false;
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

// Only positions with configured units are unit-scoped.
export function assertJobPositionUnitCompatible(
  jobPositionName: string,
  allowedUnitNames: string[],
  employeeUnitName: string,
): void {
  if (allowedUnitNames.length === 0) return;

  const normalizedUnit = employeeUnitName.trim().toLowerCase();
  const allowed = new Set(
    allowedUnitNames.map((name) => name.trim().toLowerCase()),
  );
  if (!allowed.has(normalizedUnit)) {
    throw new ResponseError(
      400,
      `Job position "${jobPositionName}" is only valid for: ${allowedUnitNames.join(", ")} (got unit "${employeeUnitName}")`,
    );
  }
}

export async function assertJobPositionUnitCompatibleByIds(
  jobPositionId: string,
  unitId: string,
  client: typeof prismaClient | Prisma.TransactionClient = prismaClient,
): Promise<void> {
  const [jobPosition, unit] = await Promise.all([
    client.masterJobPosition.findUnique({
      where: { id: jobPositionId },
      include: { units: { include: { unit: true } } },
    }),
    client.masterUnit.findUnique({ where: { id: unitId } }),
  ]);

  // Missing job position/unit is a different problem (bad FK), handled elsewhere.
  if (!jobPosition || !unit) return;

  assertJobPositionUnitCompatible(
    jobPosition.name,
    jobPosition.units.map((u) => u.unit.name),
    unit.name,
  );
}
