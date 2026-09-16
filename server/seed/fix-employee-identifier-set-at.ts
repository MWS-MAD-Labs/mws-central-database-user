// Usage:
//   bun run fix:employee-identifier-set-at
//
// One-time data fix for the new nik_set_at/npwp_set_at/bank_account_number_set_at/
// bpjs_number_set_at/bpjs_employment_number_set_at/kpj_number_set_at columns
// (see employee-service.ts's assertIdentifierFieldsEditable() calls) - a
// row with an already-set identifier but a null *_set_at predates this
// column, so the 1-day edit grace period falls back to employee.created_at,
// which is almost always long past for any real employee. That leaves an
// identifier set recently (after the employee record itself was created)
// permanently locked, with no way to trigger a fresh *_set_at short of
// soft-delete + recreate.
//
// Backfills *_set_at = updated_at for any row where the identifier is set
// but *_set_at is still null - updated_at is a reasonable best-effort proxy
// for "roughly when this was last touched" (it's not per-field, so an
// unrelated field edit can make this look more recent than the identifier
// actually is - a one-time, self-correcting imprecision: the next genuine
// edit to that specific field re-anchors it precisely from then on).
//
// Safe to re-run - only ever touches rows where *_set_at is still null.

import { prismaClient } from "../src/lib/prisma";

const FIELDS = [
  { column: "nik", setAtColumn: "nik_set_at" },
  { column: "npwp", setAtColumn: "npwp_set_at" },
  { column: "bank_account_number", setAtColumn: "bank_account_number_set_at" },
  { column: "bpjs_number", setAtColumn: "bpjs_number_set_at" },
  {
    column: "bpjs_employment_number",
    setAtColumn: "bpjs_employment_number_set_at",
  },
  { column: "kpj_number", setAtColumn: "kpj_number_set_at" },
];

async function main() {
  for (const { column, setAtColumn } of FIELDS) {
    const result = await prismaClient.$executeRawUnsafe(
      `UPDATE "employees" SET "${setAtColumn}" = "updated_at" WHERE "${column}" IS NOT NULL AND "${setAtColumn}" IS NULL`,
    );
    console.log(`${setAtColumn}: backfilled ${result} row(s).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
