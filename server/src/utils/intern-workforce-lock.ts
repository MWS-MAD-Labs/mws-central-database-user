import type { Prisma } from "../generated/prisma/client";

// Serializes support assignments for one teacher, so two requests cannot both fit under the caseload limit.
export async function lockSupportCaseload(
  tx: Prisma.TransactionClient,
  memberKey: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support-caseload:${memberKey}`}, 0))`;
}

export async function lockInternWorkforce(
  tx: Prisma.TransactionClient,
  internId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intern-workforce:${internId}`}, 0))`;
}
