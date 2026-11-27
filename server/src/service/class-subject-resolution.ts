import type { Prisma } from "../generated/prisma/client";
import { ResponseError } from "../error/response-error";
import { subjectKey, subjectName } from "../utils/subject-key";

export type ResolvedSubject = { id: string; name: string };

// The subject an assignment is for: the one chosen from the list, or the one written as text, which is found by its key or made, so a client that still
// sends the text keeps working. Without either there is none.
export async function resolveAssignmentSubject(tx: Prisma.TransactionClient, input: { subject_id?: string; subject?: string }): Promise<ResolvedSubject | null> {
  if (input.subject_id) {
    const row = await tx.masterSubject.findUnique({ where: { id: input.subject_id }, select: { id: true, name: true } });
    if (!row) throw new ResponseError(400, "Subject not found");
    return row;
  }
  if (input.subject === undefined) return null;
  const name = subjectName(input.subject);
  const key = subjectKey(name);
  if (!key) throw new ResponseError(400, "Use letters or numbers in the subject name");
  const found = await tx.masterSubject.findUnique({ where: { key }, select: { id: true, name: true } });
  if (found) return found;
  return tx.masterSubject.create({ data: { key, name }, select: { id: true, name: true } });
}
