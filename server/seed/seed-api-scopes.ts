// Usage:
//   bun run seed:api-scopes
//
// Seeds the api_scopes catalog from the API_SCOPES constant so API Clients
// can actually be granted these scopes (the create-tables migration only
// creates the table, it doesn't insert rows).
//
// Safe to re-run - every row is an upsert by name.

import { prismaClient } from "../src/lib/prisma";
import { API_SCOPES } from "../src/constants/api-scopes";

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [API_SCOPES.EMPLOYEES_READ]: "Read employee profile data",
  [API_SCOPES.STUDENTS_READ]: "Read student profile data",
  [API_SCOPES.STUDENTS_ACADEMIC_HISTORY_READ]: "Read student academic history",
  [API_SCOPES.STUDENTS_HEALTH_READ]: "Read student health records",
  [API_SCOPES.STUDENTS_CONSENT_READ]: "Read student consent attachments",
};

async function main() {
  for (const name of Object.values(API_SCOPES)) {
    await prismaClient.apiScope.upsert({
      where: { name },
      update: {},
      create: { name, description: SCOPE_DESCRIPTIONS[name] },
    });
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
