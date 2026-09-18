// Backfill missing identifier timestamps from updated_at. Safe to re-run.

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
