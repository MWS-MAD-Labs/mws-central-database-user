import "dotenv/config";
import { AdminRole } from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";
import { linkAdminToEmployee } from "../src/utils/admin-person-link";

const email = process.env.BOOTSTRAP_ADMIN_EMAIL || Bun.argv[2];
const fullName =
  process.env.BOOTSTRAP_ADMIN_NAME ||
  Bun.argv.slice(3).join(" ") ||
  email?.split("@")[0].replace(/[._-]/g, " ");
const allowedDomain = process.env.ALLOWED_DOMAIN;
const unitName = process.env.BOOTSTRAP_UNIT_NAME || "MWS";

if (!email) {
  throw new Error(
    "Provide an email: BOOTSTRAP_ADMIN_EMAIL=name@domain bun run bootstsesdarap:admin",
  );
}

if (!allowedDomain) {
  throw new Error("ALLOWED_DOMAIN is not set. Check server/.env.");
}

if (!email.endsWith(`@${allowedDomain}`)) {
  throw new Error(`Email must use @${allowedDomain}. Got ${email}.`);
}

const unit = await prismaClient.masterUnit.upsert({
  where: { name: unitName },
  update: {},
  create: { name: unitName },
});

const admin = await prismaClient.adminUser.upsert({
  where: { email },
  update: {
    full_name: fullName,
    role: AdminRole.SUPER_ADMIN,
    unit_id: unit.id,
    is_active: true,
  },
  create: {
    email,
    full_name: fullName,
    role: AdminRole.SUPER_ADMIN,
    unit_id: unit.id,
    is_active: true,
  },
});

console.log(`Bootstrapped SUPER_ADMIN: ${admin.email}`);

// When the employee is already there, the admin is tied to their record now instead of at the next sign-in.
const linked = await linkAdminToEmployee(admin.email);
console.log(linked ? "Linked to the employee record." : "No employee record with this email yet. It is linked when the employee is added.");
console.log(`Unit: ${unit.name} (${unit.id})`);

await prismaClient.$disconnect();
