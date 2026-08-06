import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import { StudentEntryType } from "../generated/prisma/client";

// NIS format (7 digits): YY (entry year) + U (unit) + E (entry type) + NNN
// (sequence per YY+U). Assigned once at create, never regenerated.

function deriveUnitCode(gradeLevel: number): "0" | "1" | "2" {
  if (gradeLevel <= 0) return "0"; // Kindergarten (Pre-K, K1, K2)
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

// Shared by generateNis() and the import NIS pattern check - import only
// compares against this, never allocates a sequence.
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

  // Finds the smallest unused sequence (1-999) for this prefix, not just
  // max+1 - otherwise a gap below the highest existing nis (e.g. one
  // backfilled directly from a legacy import) stays permanently unused,
  // wasting slots against the hard 999-per-prefix cap. Includes
  // soft-deleted students in the "taken" set - nis is a hard unique
  // constraint, numbers stay reserved.
  const rows = await prismaClient.$queryRaw<{ seq: number }[]>`
    SELECT gs.n AS seq
    FROM generate_series(1, 999) AS gs(n)
    WHERE NOT EXISTS (
      SELECT 1 FROM students s WHERE s.nis = ${prefix} || LPAD(gs.n::text, 3, '0')
    )
    ORDER BY gs.n
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new ResponseError(
      400,
      `Cannot generate NIS: sequence for prefix ${prefix} is exhausted (999 reached)`,
    );
  }

  return `${prefix}${String(rows[0].seq).padStart(3, "0")}`;
}
