import {
  EmployeeStatus,
  type Prisma,
} from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";

const OCCUPYING_EMPLOYEE_STATUSES = [
  EmployeeStatus.ACTIVE,
  EmployeeStatus.ON_LEAVE,
];

export async function lockJobPositionCapacityConfig(
  tx: Prisma.TransactionClient,
  jobPositionId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job-position-capacity-config:${jobPositionId}`}, 0))`;
}

export async function assertJobPositionCapacity(
  tx: Prisma.TransactionClient,
  input: {
    jobPositionId: string;
    unitId: string;
    employeeId?: string;
    internId?: string;
    occupiesSlot: boolean;
  },
): Promise<void> {
  if (!input.occupiesSlot) return;

  await lockJobPositionCapacityConfig(tx, input.jobPositionId);

  const position = await tx.masterJobPosition.findUnique({
    where: { id: input.jobPositionId },
    select: {
      name: true,
      capacity_scope: true,
      max_active_holders: true,
    },
  });
  if (!position?.capacity_scope || !position.max_active_holders) return;

  const lockKey =
    position.capacity_scope === "PER_UNIT"
      ? `job-position-capacity:${input.jobPositionId}:${input.unitId}`
      : `job-position-capacity:${input.jobPositionId}:global`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const unitFilter =
    position.capacity_scope === "PER_UNIT" ? { unit_id: input.unitId } : {};
  const employeeCount = await tx.employee.count({
    where: {
      job_position_id: input.jobPositionId,
      ...unitFilter,
      status: { in: OCCUPYING_EMPLOYEE_STATUSES },
      deleted_at: null,
      ...(input.employeeId ? { id: { not: input.employeeId } } : {}),
    },
  });
  const internCount = await tx.intern.count({
    where: {
      job_position_id: input.jobPositionId,
      ...unitFilter,
      status: "ACTIVE",
      deleted_at: null,
      end_date: { gt: new Date() },
      ...(input.internId ? { id: { not: input.internId } } : {}),
    },
  });
  const occupied = employeeCount + internCount;
  if (occupied >= position.max_active_holders) {
    const scopeLabel =
      position.capacity_scope === "PER_UNIT" ? "in this unit" : "globally";
    throw new ResponseError(
      400,
      `Job position "${position.name}" is limited to ${position.max_active_holders} active holder${position.max_active_holders === 1 ? "" : "s"} ${scopeLabel}. Deactivate, resign, archive, or reassign an existing holder first.`,
    );
  }
}

export async function assertExistingHoldersFitCapacity(
  tx: Prisma.TransactionClient,
  input: {
    jobPositionId: string;
    scope: "PER_UNIT" | "GLOBAL" | null;
    maximum: number | null;
  },
): Promise<void> {
  await lockJobPositionCapacityConfig(tx, input.jobPositionId);
  if (!input.scope || !input.maximum) return;

  if (input.scope === "GLOBAL") {
    const employeeCount = await tx.employee.count({
      where: {
        job_position_id: input.jobPositionId,
        status: { in: OCCUPYING_EMPLOYEE_STATUSES },
        deleted_at: null,
      },
    });
    const internCount = await tx.intern.count({
      where: {
        job_position_id: input.jobPositionId,
        status: "ACTIVE",
        deleted_at: null,
        end_date: { gt: new Date() },
      },
    });
    if (employeeCount + internCount > input.maximum) {
      throw new ResponseError(
        400,
        `Cannot set this global capacity to ${input.maximum}: ${employeeCount + internCount} active holders currently use this position.`,
      );
    }
    return;
  }

  const employeeGroups = await tx.employee.groupBy({
    by: ["unit_id"],
    where: {
      job_position_id: input.jobPositionId,
      status: { in: OCCUPYING_EMPLOYEE_STATUSES },
      deleted_at: null,
    },
    _count: { _all: true },
  });
  const internGroups = await tx.intern.groupBy({
    by: ["unit_id"],
    where: {
      job_position_id: input.jobPositionId,
      status: "ACTIVE",
      deleted_at: null,
      end_date: { gt: new Date() },
    },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const group of employeeGroups) {
    counts.set(group.unit_id, group._count._all);
  }
  for (const group of internGroups) {
    counts.set(
      group.unit_id,
      (counts.get(group.unit_id) ?? 0) + group._count._all,
    );
  }
  const highest = Math.max(0, ...counts.values());
  if (highest > input.maximum) {
    throw new ResponseError(
      400,
      `Cannot set this per-unit capacity to ${input.maximum}: at least one unit currently has ${highest} active holders.`,
    );
  }
}
