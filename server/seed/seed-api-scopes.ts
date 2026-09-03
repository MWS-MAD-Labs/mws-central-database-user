// Usage:
//   bun run seed:api-scopes
//
// Manual/CI convenience wrapper around syncApiScopes() - the server itself
// now also runs this at boot (see src/index.ts), so this script is no
// longer required after a deploy. Kept for local dev and one-off checks.
//
// Safe to re-run - every row is an upsert by name.

import { prismaClient } from "../src/lib/prisma";
import { API_SCOPES } from "../src/constants/api-scopes";
import { syncApiScopes } from "../src/lib/sync-api-scopes";

async function main() {
  await syncApiScopes();
  for (const name of Object.values(API_SCOPES)) {
    console.log(`Scope ready: ${name}`);
  }
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
