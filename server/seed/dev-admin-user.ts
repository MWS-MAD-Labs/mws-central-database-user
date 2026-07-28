// Usage:
//   bun run seed/inject-admin.ts

import { AdminRole } from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";

const TARGET_EMAIL = "rizqi@millennia21.id"; // Your Email;

async function main() {
  console.log(`Memulai proses inject untuk: ${TARGET_EMAIL}...`);

  const unit = await prismaClient.masterUnit.upsert({
    where: { name: "DEV_UNIT" },
    update: {},
    create: { name: "DEV_UNIT" },
  });

  await prismaClient.masterJobPosition.upsert({
    where: { name: "DEV_POS" },
    update: {},
    create: { name: "DEV_POS" },
  });

  await prismaClient.masterJobLevel.upsert({
    where: { name: "DEV_LEV" },
    update: {},
    create: { name: "DEV_LEV" },
  });

  const admin = await prismaClient.adminUser.upsert({
    where: { email: TARGET_EMAIL },
    update: {
      is_active: true,
      role: AdminRole.SUPER_ADMIN,
      unit_id: unit.id,
    },
    create: {
      email: TARGET_EMAIL,
      full_name: "Rizqi",
      role: AdminRole.SUPER_ADMIN,
      unit_id: unit.id,
      is_active: true,
    },
  });

  console.log(`\nSuccess`);
  console.log(`-------------------------------------`);
  console.log(`ID    : ${admin.id}`);
  console.log(`Email : ${admin.email}`);
  console.log(`Role  : ${admin.role}`);
  console.log(`Status: ${admin.is_active ? "Active" : "Inactive"}`);
  console.log(`-------------------------------------`);
}

main()
  .catch((error) => {
    console.error("Erorr:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
