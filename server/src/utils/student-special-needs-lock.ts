import type { Prisma } from "../generated/prisma/client";

// Serializes eligibility/profile changes with SE assignment create/reactivate.
export async function lockStudentSpecialNeeds(
  tx: Prisma.TransactionClient,
  studentId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`student-special-needs:${studentId}`}, 0))`;
}
