import type { Prisma } from "../generated/prisma/client";

export async function lockInternWorkforce(
  tx: Prisma.TransactionClient,
  internId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intern-workforce:${internId}`}, 0))`;
}
