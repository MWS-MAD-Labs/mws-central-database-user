// Usage:
//   bun run seed/dev-admin-user.ts

import { AdminRole } from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";

const TARGET_EMAIL = process.env.DEV_ADMIN_EMAIL;

async function main() {
  if (!TARGET_EMAIL) {
    throw new Error("DEV_ADMIN_EMAIL is not set — check server/.env");
  }

  console.log(`Memulai proses inject untuk: ${TARGET_EMAIL}...`);

  const unit = await prismaClient.masterUnit.findUniqueOrThrow({
    where: { name: "MAD Lab" },
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
      full_name: TARGET_EMAIL.split("@")[0],
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
  console.log(`Unit  : ${unit.name}`);
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
