// Usage:
//   bun run seed/dev-admin-user.ts

import { AdminRole } from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";

const TARGET_EMAIL = process.env.DEV_ADMIN_EMAIL;
const DUMMY_DB_ADMIN_EMAIL = "dummystaff@millennia21.id";

async function main() {
  if (!TARGET_EMAIL) {
    throw new Error("DEV_ADMIN_EMAIL is not set — check server/.env");
  }

  console.log(`Memulai proses inject untuk admin users...`);

  const [madLabUnit, jhUnit] = await Promise.all([
    prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "MAD Lab" },
    }),
    prismaClient.masterUnit.findUniqueOrThrow({
      where: { name: "Junior High" },
    }),
  ]);

  const superAdmin = await prismaClient.adminUser.upsert({
    where: { email: TARGET_EMAIL },
    update: {
      is_active: true,
      role: AdminRole.SUPER_ADMIN,
      unit_id: madLabUnit.id,
    },
    create: {
      email: TARGET_EMAIL,
      full_name: TARGET_EMAIL.split("@")[0],
      role: AdminRole.SUPER_ADMIN,
      unit_id: madLabUnit.id,
      is_active: true,
    },
  });

  const dbAdmin = await prismaClient.adminUser.upsert({
    where: { email: DUMMY_DB_ADMIN_EMAIL },
    update: {
      is_active: true,
      role: AdminRole.DATABASE_ADMIN,
      unit_id: jhUnit.id,
      can_write_employee_data: true,
      can_write_student_data: true,
    },
    create: {
      email: DUMMY_DB_ADMIN_EMAIL,
      full_name: "Dummy Staff",
      role: AdminRole.DATABASE_ADMIN,
      unit_id: jhUnit.id,
      is_active: true,
      can_write_employee_data: true,
      can_write_student_data: true,
    },
  });

  console.log(`\nSuccess - SUPER_ADMIN`);
  console.log(`-------------------------------------`);
  console.log(`ID    : ${superAdmin.id}`);
  console.log(`Email : ${superAdmin.email}`);
  console.log(`Role  : ${superAdmin.role}`);
  console.log(`Unit  : ${madLabUnit.name}`);
  console.log(`Status: ${superAdmin.is_active ? "Active" : "Inactive"}`);

  console.log(`\nSuccess - DATABASE_ADMIN`);
  console.log(`-------------------------------------`);
  console.log(`ID    : ${dbAdmin.id}`);
  console.log(`Email : ${dbAdmin.email}`);
  console.log(`Role  : ${dbAdmin.role}`);
  console.log(`Unit  : ${jhUnit.name}`);
  console.log(`Write Employee: ${dbAdmin.can_write_employee_data ? "Yes" : "No"}`);
  console.log(`Write Student : ${dbAdmin.can_write_student_data ? "Yes" : "No"}`);
  console.log(`Status: ${dbAdmin.is_active ? "Active" : "Inactive"}`);
  console.log(`-------------------------------------`);
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
