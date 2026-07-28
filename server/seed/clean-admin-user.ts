// Usage:
//   bun run seed/clean-admin-user.ts

import { prismaClient } from "../src/lib/prisma";

const TARGET_EMAIL = "rizqi@millennia21.id";

async function main() {
  console.log(`Memulai proses pembersihan untuk: ${TARGET_EMAIL}...`);

  const deletedAdmin = await prismaClient.adminUser.deleteMany({
    where: { email: TARGET_EMAIL },
  });
  console.log(`- Deleted ${deletedAdmin.count} AdminUser.`);

  const deletedLevel = await prismaClient.masterJobLevel.deleteMany({
    where: { name: "DEV_LEV" },
  });
  console.log(`- Deleted ${deletedLevel.count} Job Level.`);

  const deletedPos = await prismaClient.masterJobPosition.deleteMany({
    where: { name: "DEV_POS" },
  });
  console.log(`- Deleted ${deletedPos.count} Job Position.`);

  const deletedUnit = await prismaClient.masterUnit.deleteMany({
    where: { name: "DEV_UNIT" },
  });
  console.log(`- Deleted ${deletedUnit.count} Unit.`);

  console.log(`\nSuccess.`);
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
