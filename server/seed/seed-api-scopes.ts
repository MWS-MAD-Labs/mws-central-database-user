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
