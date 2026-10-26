// Creates the roles of an application in Central from a preset file the application ships (Learnspace has
// role-presets.json), instead of ticking the same permissions by hand in Application Access.
//
//   bun run seed:application-roles <file> --as <super admin email> [--dry-run]
//
// A role that already exists is left alone. The permissions have to be published by the application first, and a role
// is made the same way the page makes it, as the Super Admin named with --as, so the checks and the audit log are the same.
import { readFileSync } from "fs";
import { AdminRole } from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";
import { ApplicationRoleService } from "../src/service/application-entitlement-service";

export type PresetRole = {
  key: string;
  label: string;
  permissions: string[];
  allows_employees?: boolean;
  allows_students?: boolean;
  allows_interns?: boolean;
};

export type Planned =
  | { key: string; action: "create"; role: PresetRole }
  | { key: string; action: "skip"; reason: string };

// What would happen to each preset, given the roles the application has and the permissions it published.
export function planRoles(
  presets: PresetRole[],
  existing: { key: string; permissions: string[]; is_active: boolean }[],
  published: string[],
): Planned[] {
  const known = new Set(published);
  const taken = new Map(existing.map((role) => [role.key, role]));
  const signature = (permissions: string[]) => [...new Set(permissions)].sort().join("\n");
  const sets = new Map(existing.filter((role) => role.is_active).map((role) => [signature(role.permissions), role.key]));
  return presets.map((role) => {
    if (taken.has(role.key)) return { key: role.key, action: "skip", reason: "already exists" };
    const missing = role.permissions.filter((permission) => !known.has(permission));
    if (missing.length) return { key: role.key, action: "skip", reason: `permissions not published yet: ${missing.join(", ")}` };
    const twin = sets.get(signature(role.permissions));
    if (twin) return { key: role.key, action: "skip", reason: `${twin} already has the same permissions` };
    sets.set(signature(role.permissions), role.key);
    return { key: role.key, action: "create", role };
  });
}

async function main() {
  const file = Bun.argv[2];
  const asIndex = Bun.argv.indexOf("--as");
  const email = asIndex > -1 ? Bun.argv[asIndex + 1] : undefined;
  const dryRun = Bun.argv.includes("--dry-run");
  if (!file || !email) throw new Error("Usage: bun run seed:application-roles <file> --as <super admin email> [--dry-run]");

  const preset = JSON.parse(readFileSync(file, "utf8")) as { application_id: string; roles: PresetRole[] };
  const admin = await prismaClient.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!admin || admin.role !== AdminRole.SUPER_ADMIN) throw new Error(`${email} is not a Super Admin`);

  const [existing, published] = await Promise.all([
    prismaClient.applicationRole.findMany({ where: { application_id: preset.application_id }, select: { key: true, permissions: true, is_active: true } }),
    prismaClient.applicationPermission.findMany({ where: { application_id: preset.application_id, deprecated_at: null }, select: { key: true } }),
  ]);
  const plan = planRoles(preset.roles, existing, published.map((row) => row.key));
  for (const step of plan) {
    if (step.action === "skip") {
      console.log(`skip    ${step.key}: ${step.reason}`);
      continue;
    }
    if (dryRun) {
      console.log(`create  ${step.key} (${step.role.permissions.length} permissions)`);
      continue;
    }
    await ApplicationRoleService.create(admin, { application_id: preset.application_id, ...step.role });
    console.log(`created ${step.key}`);
  }
  if (dryRun) console.log("Dry run, nothing was written.");
}

if (import.meta.main) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prismaClient.$disconnect());
}
