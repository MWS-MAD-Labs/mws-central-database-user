import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import { StudentEntryType } from "../generated/prisma/client";

// School's NIS convention (7 digits): YY (entry year) + U (unit) + E (entry
// type) + NNN (sequence within that YY+U bucket). Assigned once at create
// and never regenerated, even as the student progresses through grades -
// see StudentService.create().

function deriveUnitCode(gradeLevel: number): "0" | "1" | "2" {
  if (gradeLevel < 0) return "0"; // Kindergarten (Pre-K, K1, K2)
  if (gradeLevel >= 1 && gradeLevel <= 6) return "1"; // Elementary
  if (gradeLevel >= 7 && gradeLevel <= 9) return "2"; // Junior High
  throw new ResponseError(
    400,
    `Cannot generate NIS: grade level ${gradeLevel} is outside the known Kindergarten/Elementary/Junior High ranges`,
  );
}

function deriveEntryTypeCode(entryType: StudentEntryType): "0" | "1" | "2" {
  switch (entryType) {
    case StudentEntryType.PRE_K:
      return "0";
    case StudentEntryType.PSB:
      return "1";
    case StudentEntryType.TRANSFER:
      return "2";
  }
}

function deriveEntryYear(academicYear: {
  name: string;
  start_date: Date | null;
}): string {
  if (academicYear.start_date) {
    return String(academicYear.start_date.getFullYear()).slice(-2);
  }

  const match = academicYear.name.match(/\d{4}/);
  if (match) return match[0].slice(-2);

  throw new ResponseError(
    400,
    `Cannot generate NIS: academic year "${academicYear.name}" has no start_date and no 4-digit year in its name`,
  );
}

// Shared by generateNis() (create) and the import preview's NIS pattern
// check (import-service.ts) - both need the same digit derivation, but
// import only checks a supplied nis against this, never allocates a sequence.
export function computeNisPrefix(params: {
  academicYear: { name: string; start_date: Date | null };
  gradeLevel: number;
  entryType: StudentEntryType;
}): string {
  const year = deriveEntryYear(params.academicYear);
  const unit = deriveUnitCode(params.gradeLevel);
  const entryTypeCode = deriveEntryTypeCode(params.entryType);
  return `${year}${unit}${entryTypeCode}`;
}

export async function generateNis(params: {
  academicYear: { name: string; start_date: Date | null };
  gradeLevel: number;
  entryType: StudentEntryType;
}): Promise<string> {
  const prefix = computeNisPrefix(params);

  // Includes soft-deleted students - nis is a hard unique constraint, so a
  // deleted student's number stays reserved forever and must not be reissued.
  const latest = await prismaClient.student.findFirst({
    where: { nis: { startsWith: prefix } },
    orderBy: { nis: "desc" },
    select: { nis: true },
  });

  const nextSeq = latest ? Number(latest.nis.slice(4)) + 1 : 1;
  if (nextSeq > 999) {
    throw new ResponseError(
      400,
      `Cannot generate NIS: sequence for prefix ${prefix} is exhausted (999 reached)`,
    );
  }

  return `${prefix}${String(nextSeq).padStart(3, "0")}`;
}
