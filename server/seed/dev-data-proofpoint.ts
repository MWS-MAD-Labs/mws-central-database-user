import {
  ApplicationPermissionSource,
  EmployeeStatus,
  EmploymentType,
  Gender,
  MaritalStatus,
  PersonType,
  Religion,
} from "../src/generated/prisma/client";
import { prismaClient } from "../src/lib/prisma";

const APPLICATION_ID = "proofpoint";
const HUB_APPLICATION_ID = "hub";
const HUB_ROLE = "PROOFPOINT_TEST_USER";
const EMAIL_DOMAIN = "mws-dev.local";
const GLOBAL_UNIT = "DEV_PROOFPOINT_GLOBAL";
const DEPARTMENT_UNIT = "DEV_PROOFPOINT_DEPARTMENT";
const BUILDING = "DEV_PROOFPOINT_BUILDING";

const roleFixtures = [
  { role: "ADMIN", rank: 0, unit: GLOBAL_UNIT },
  { role: "DIRECTOR", rank: 1, unit: GLOBAL_UNIT },
  { role: "MANAGER", rank: 2, unit: DEPARTMENT_UNIT },
  { role: "SUPERVISOR", rank: 3, unit: DEPARTMENT_UNIT },
  { role: "STAFF", rank: 4, unit: DEPARTMENT_UNIT },
] as const;

const permissions = [
  { key: "proofpoint.access", requires: [] },
  { key: "proofpoint.admin", requires: ["proofpoint.access"] },
  { key: "proofpoint.director", requires: ["proofpoint.access"] },
  { key: "proofpoint.manager", requires: ["proofpoint.access"] },
  { key: "proofpoint.supervisor", requires: ["proofpoint.access"] },
  { key: "proofpoint.staff", requires: ["proofpoint.access"] },
] as const;

function assertLocalDevelopmentDatabase() {
  if (process.env.ALLOW_PROOFPOINT_DEV_SEED !== "1") {
    throw new Error("Set ALLOW_PROOFPOINT_DEV_SEED=1 to run this local-only seed");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("ProofPoint development data cannot be seeded in production");
  }

  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not configured");
  const url = new URL(raw);
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!localHost || url.port !== "5434" || url.pathname !== "/mws-center") {
    throw new Error("Refusing to seed anything except local Central at localhost:5434/mws-center");
  }
}

function account(role: (typeof roleFixtures)[number]["role"]) {
  const slug = role.toLowerCase();
  return {
    email: `proofpoint.test.${slug}@${EMAIL_DOMAIN}`,
    employeeId: `DEV.PP.${role}`,
    fullName: `ProofPoint Test ${role[0]}${role.slice(1).toLowerCase()}`,
    positionName: `DEV_PROOFPOINT_POSITION_${role}`,
    levelName: `DEV_PROOFPOINT_LEVEL_${role}`,
  };
}

async function assertSyntheticIdentityIsSafe(role: (typeof roleFixtures)[number]["role"]) {
  const fixture = account(role);
  const [byEmail, byEmployeeId] = await Promise.all([
    prismaClient.person.findUnique({
      where: { email: fixture.email },
      select: { full_name: true, employee: { select: { employee_id: true } } },
    }),
    prismaClient.employee.findUnique({
      where: { employee_id: fixture.employeeId },
      select: { person: { select: { email: true, full_name: true } } },
    }),
  ]);

  if (byEmail && (byEmail.full_name !== fixture.fullName || byEmail.employee?.employee_id !== fixture.employeeId)) {
    throw new Error(`Refusing to overwrite the existing person at ${fixture.email}`);
  }
  if (byEmployeeId && (byEmployeeId.person.email !== fixture.email || byEmployeeId.person.full_name !== fixture.fullName)) {
    throw new Error(`Refusing to overwrite employee ID ${fixture.employeeId}`);
  }
}

async function main() {
  assertLocalDevelopmentDatabase();

  const database = await prismaClient.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
  if (database[0]?.database !== "mws-center") {
    throw new Error(`Connected to unexpected database ${database[0]?.database ?? "unknown"}`);
  }

  const [application, organization, hubApplication, hubOrganization, hubUsePermission] = await Promise.all([
    prismaClient.application.findUnique({
      where: { application_id: APPLICATION_ID },
      select: { retired_at: true },
    }),
    prismaClient.applicationOrganization.findUnique({ where: { application_id: APPLICATION_ID } }),
    prismaClient.application.findUnique({
      where: { application_id: HUB_APPLICATION_ID },
      select: { retired_at: true },
    }),
    prismaClient.applicationOrganization.findUnique({ where: { application_id: HUB_APPLICATION_ID } }),
    prismaClient.applicationPermission.findUnique({
      where: { application_id_key: { application_id: HUB_APPLICATION_ID, key: "hub.use" } },
    }),
  ]);
  if (!application || application.retired_at) throw new Error("The local ProofPoint application is missing or retired");
  if (!organization) throw new Error("ProofPoint has no Central organization ID");
  if (!hubApplication || hubApplication.retired_at) throw new Error("The local Hub application is missing or retired");
  if (!hubOrganization) throw new Error("Hub has no Central organization ID");
  if (!hubUsePermission || hubUsePermission.deprecated_at) throw new Error("Hub has no active hub.use permission");

  for (const fixture of roleFixtures) await assertSyntheticIdentityIsSafe(fixture.role);

  const results = await prismaClient.$transaction(async (tx) => {
    const [globalUnit, departmentUnit, building] = await Promise.all([
      tx.masterUnit.upsert({ where: { name: GLOBAL_UNIT }, update: {}, create: { name: GLOBAL_UNIT } }),
      tx.masterUnit.upsert({ where: { name: DEPARTMENT_UNIT }, update: {}, create: { name: DEPARTMENT_UNIT } }),
      tx.masterBuilding.upsert({ where: { name: BUILDING }, update: {}, create: { name: BUILDING } }),
    ]);

    for (const permission of permissions) {
      await tx.applicationPermission.upsert({
        where: { application_id_key: { application_id: APPLICATION_ID, key: permission.key } },
        update: {
          requires: [...permission.requires],
          source: ApplicationPermissionSource.MANIFEST,
          deprecated_at: null,
          synced_at: new Date(),
        },
        create: {
          application_id: APPLICATION_ID,
          key: permission.key,
          description: `ProofPoint permission ${permission.key}`,
          requires: [...permission.requires],
          source: ApplicationPermissionSource.MANIFEST,
          synced_at: new Date(),
        },
      });
    }

    for (const fixture of roleFixtures) {
      const rolePermissions = ["proofpoint.access", `proofpoint.${fixture.role.toLowerCase()}`];
      await tx.applicationRole.upsert({
        where: { application_id_key: { application_id: APPLICATION_ID, key: fixture.role } },
        update: {
          label: fixture.role[0] + fixture.role.slice(1).toLowerCase(),
          permissions: rolePermissions,
          rank: fixture.rank,
          allows_employees: true,
          allows_students: false,
          allows_interns: false,
          is_active: true,
        },
        create: {
          application_id: APPLICATION_ID,
          key: fixture.role,
          label: fixture.role[0] + fixture.role.slice(1).toLowerCase(),
          permissions: rolePermissions,
          rank: fixture.rank,
          allows_employees: true,
        },
      });
    }

    await tx.applicationRole.upsert({
      where: { application_id_key: { application_id: HUB_APPLICATION_ID, key: HUB_ROLE } },
      update: {
        label: "ProofPoint test user",
        permissions: ["hub.use"],
        rank: 999,
        allows_employees: true,
        allows_students: false,
        allows_interns: false,
        is_active: true,
      },
      create: {
        application_id: HUB_APPLICATION_ID,
        key: HUB_ROLE,
        label: "ProofPoint test user",
        permissions: ["hub.use"],
        rank: 999,
        allows_employees: true,
      },
    });

    const seeded = [];
    for (const fixture of roleFixtures) {
      const details = account(fixture.role);
      const unit = fixture.unit === GLOBAL_UNIT ? globalUnit : departmentUnit;
      const [position, level] = await Promise.all([
        tx.masterJobPosition.upsert({
          where: { name: details.positionName },
          update: {},
          create: { name: details.positionName },
        }),
        tx.masterJobLevel.upsert({
          where: { name: details.levelName },
          update: {},
          create: { name: details.levelName },
        }),
      ]);
      await Promise.all([
        tx.masterJobPositionUnit.upsert({
          where: { job_position_id_unit_id: { job_position_id: position.id, unit_id: unit.id } },
          update: {},
          create: { job_position_id: position.id, unit_id: unit.id },
        }),
        tx.masterJobLevelUnit.upsert({
          where: { job_level_id_unit_id: { job_level_id: level.id, unit_id: unit.id } },
          update: {},
          create: { job_level_id: level.id, unit_id: unit.id },
        }),
      ]);

      let person = await tx.person.findUnique({ where: { email: details.email } });
      if (!person) {
        person = await tx.person.create({
          data: {
            full_name: details.fullName,
            nick_name: `PP ${fixture.role}`,
            email: details.email,
            person_type: PersonType.EMPLOYEE,
            gender: fixture.rank % 2 === 0 ? Gender.FEMALE : Gender.MALE,
            religion: Religion.OTHER,
            religion_other: "Synthetic test data",
            birth_place: "Development Fixture",
            birth_date: new Date("1990-01-01"),
          },
        });
      } else if (person.deleted_at) {
        person = await tx.person.update({
          where: { id: person.id },
          data: { deleted_at: null },
        });
      }

      await tx.employee.upsert({
        where: { person_id: person.id },
        update: {
          status: EmployeeStatus.ACTIVE,
          deleted_at: null,
          unit_id: unit.id,
          job_position_id: position.id,
          job_level_id: level.id,
          building_id: building.id,
        },
        create: {
          person_id: person.id,
          employee_id: details.employeeId,
          status: EmployeeStatus.ACTIVE,
          employment_type: EmploymentType.PERMANENT,
          unit_id: unit.id,
          job_position_id: position.id,
          job_level_id: level.id,
          building_id: building.id,
          join_date: new Date("2026-01-01"),
          marital_status: MaritalStatus.SINGLE,
        },
      });

      const rolePermissions = ["proofpoint.access", `proofpoint.${fixture.role.toLowerCase()}`];
      const existingEntitlement = await tx.applicationEntitlement.findUnique({
        where: { person_id_application_id: { person_id: person.id, application_id: APPLICATION_ID } },
      });
      const entitlementMatches = existingEntitlement
        && existingEntitlement.organization_id === organization.organization_id
        && existingEntitlement.role === fixture.role
        && existingEntitlement.is_active
        && existingEntitlement.permissions.length === rolePermissions.length
        && rolePermissions.every((permission) => existingEntitlement.permissions.includes(permission));

      const entitlement = entitlementMatches
        ? existingEntitlement
        : existingEntitlement
          ? await tx.applicationEntitlement.update({
              where: { id: existingEntitlement.id },
              data: {
                organization_id: organization.organization_id,
                role: fixture.role,
                permissions: rolePermissions,
                is_active: true,
                version: { increment: 1 },
                granted_at: new Date(),
              },
            })
          : await tx.applicationEntitlement.create({
              data: {
                person_id: person.id,
                application_id: APPLICATION_ID,
                organization_id: organization.organization_id,
                role: fixture.role,
                permissions: rolePermissions,
              },
            });

      const existingHubEntitlement = await tx.applicationEntitlement.findUnique({
        where: { person_id_application_id: { person_id: person.id, application_id: HUB_APPLICATION_ID } },
      });
      const hubEntitlementMatches = existingHubEntitlement
        && existingHubEntitlement.organization_id === hubOrganization.organization_id
        && existingHubEntitlement.role === HUB_ROLE
        && existingHubEntitlement.is_active
        && existingHubEntitlement.permissions.length === 1
        && existingHubEntitlement.permissions[0] === "hub.use";
      const hubEntitlement = hubEntitlementMatches
        ? existingHubEntitlement
        : existingHubEntitlement
          ? await tx.applicationEntitlement.update({
              where: { id: existingHubEntitlement.id },
              data: {
                organization_id: hubOrganization.organization_id,
                role: HUB_ROLE,
                permissions: ["hub.use"],
                is_active: true,
                version: { increment: 1 },
                granted_at: new Date(),
              },
            })
          : await tx.applicationEntitlement.create({
              data: {
                person_id: person.id,
                application_id: HUB_APPLICATION_ID,
                organization_id: hubOrganization.organization_id,
                role: HUB_ROLE,
                permissions: ["hub.use"],
              },
            });

      seeded.push({
        email: details.email,
        employee_id: details.employeeId,
        person_id: person.id,
        role: fixture.role,
        permissions: rolePermissions,
        unit: unit.name,
        unit_id: unit.id,
        entitlement_id: entitlement.id,
        entitlement_version: entitlement.version,
        hub_role: hubEntitlement.role,
        hub_permissions: hubEntitlement.permissions,
        hub_entitlement_id: hubEntitlement.id,
        hub_entitlement_version: hubEntitlement.version,
      });
    }
    return seeded;
  });

  console.log(JSON.stringify({ database: "mws-center", application: APPLICATION_ID, accounts: results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
