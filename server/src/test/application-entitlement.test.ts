import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { AuditAction, EmployeeStatus } from "../generated/prisma/client";
import { API_SCOPES } from "../constants/api-scopes";
import { prismaClient } from "../lib/prisma";
import {
  AdminUserTest,
  ApiClientTest,
  EmployeeTest,
  TestRequest,
} from "./test-utils";

const BASELINE_MARKER = "test_baseline_org";
const STAFF_PERMISSIONS = ["credentials.read", "pos.catalog.read", "store.use"];
const ADMIN_PERMISSIONS = [
  "app.admin", "dashboard.read", "analytics.read", "users.manage",
  "credentials.read", "credentials.manage", "accurate.manage",
  "inventory.export", "inventory.import", "borrowing.manage",
  "pos.catalog.read", "pos.manage", "pos.checkout", "pos.sales.read",
  "pos.sales.void", "allowance.manage", "allowance.collect", "store.use",
];

const DAILY_CHECKIN_PERMISSIONS = {
  PARTICIPANT: [
    "checkin.self.read",
    "checkin.self.submit",
    "support.contacts.read",
    "notifications.self.manage",
    "assistant.use",
  ],
  EDUCATOR: [
    "checkin.self.read",
    "checkin.self.submit",
    "support.contacts.read",
    "notifications.self.manage",
    "assistant.use",
    "student_checkins.read",
  ],
  SUPPORT: [
    "checkin.self.read",
    "checkin.self.submit",
    "support.contacts.read",
    "notifications.self.manage",
    "assistant.use",
    "student_checkins.read",
    "dashboard.read",
    "support_requests.manage",
  ],
  ADMIN: [
    "checkin.self.read",
    "checkin.self.submit",
    "support.contacts.read",
    "notifications.self.manage",
    "assistant.use",
    "student_checkins.read",
    "dashboard.read",
    "support_requests.manage",
    "users.read",
    "users.manage",
    "organizations.manage",
    "notifications.create",
    "sync.read",
    "sync.run",
    "dev_topology.read",
  ],
  SUPERADMIN: [
    "checkin.self.read",
    "checkin.self.submit",
    "support.contacts.read",
    "notifications.self.manage",
    "assistant.use",
    "student_checkins.read",
    "dashboard.read",
    "support_requests.manage",
    "users.read",
    "users.manage",
    "organizations.manage",
    "notifications.create",
    "sync.read",
    "sync.run",
    "dev_topology.read",
    "users.deactivate",
    "dashboard.export",
  ],
} as const;

describe("application entitlements", () => {
  let fixtureKey: string;
  let masterData: {
    unit: { id: string };
    position: { id: string };
    level: { id: string };
    building: { id: string };
  };
  const personIds: string[] = [];
  const adminIds: string[] = [];
  const apiClientIds: string[] = [];
  const entitlementIds: string[] = [];

  beforeEach(async () => {
    fixtureKey = `${Date.now()}_${randomBytes(4).toString("hex")}`;
    const [unit, position, level, building] = await Promise.all([
      prismaClient.masterUnit.create({ data: { name: `TEST_ENTITLEMENT_UNIT_${fixtureKey}` } }),
      prismaClient.masterJobPosition.create({ data: { name: `TEST_ENTITLEMENT_POSITION_${fixtureKey}` } }),
      prismaClient.masterJobLevel.create({ data: { name: `TEST_ENTITLEMENT_LEVEL_${fixtureKey}` } }),
      prismaClient.masterBuilding.create({ data: { name: `TEST_ENTITLEMENT_BUILDING_${fixtureKey}` } }),
    ]);
    masterData = { unit, position, level, building };

    // People are only granted on top of a baseline. Use roles these tests never grant.
    await prismaClient.applicationRole.upsert({
      where: { application_id_key: { application_id: "daily-checkin", key: "BASELINE_TEST" } },
      update: {},
      create: { application_id: "daily-checkin", key: "BASELINE_TEST", label: "Baseline test", permissions: [] },
    });
    await prismaClient.applicationAccessRule.createMany({
      data: [
        { application_id: "exima", audience: "EMPLOYEES", default_role_key: "RESOURCE", organization_id: BASELINE_MARKER },
        { application_id: "daily-checkin", audience: "EMPLOYEES", default_role_key: "BASELINE_TEST", organization_id: BASELINE_MARKER },
      ],
    });
  });

  afterEach(async () => {
    await prismaClient.applicationAccessRule.deleteMany({ where: { organization_id: BASELINE_MARKER } });
    await prismaClient.applicationRole.deleteMany({
      where: { application_id: "daily-checkin", key: "BASELINE_TEST" },
    });
    if (adminIds.length || apiClientIds.length || entitlementIds.length) {
      await prismaClient.auditLog.deleteMany({
        where: {
          OR: [
            ...(adminIds.length ? [{ admin_id: { in: adminIds } }] : []),
            ...(apiClientIds.length ? [{ api_client_id: { in: apiClientIds } }] : []),
            ...(entitlementIds.length ? [{ entity_id: { in: entitlementIds } }] : []),
          ],
        },
      });
    }
    if (entitlementIds.length) {
      await prismaClient.applicationEntitlement.deleteMany({ where: { id: { in: entitlementIds } } });
    }
    if (apiClientIds.length) {
      await prismaClient.apiClient.deleteMany({ where: { id: { in: apiClientIds } } });
    }
    if (adminIds.length) {
      await prismaClient.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    }
    if (personIds.length) {
      await prismaClient.employeeMutationHistory.deleteMany({
        where: { employee: { person_id: { in: personIds } } },
      });
      await prismaClient.employee.deleteMany({
        where: { person_id: { in: personIds } },
      });
      await prismaClient.person.deleteMany({ where: { id: { in: personIds } } });
    }
    await Promise.all([
      prismaClient.masterUnit.delete({ where: { id: masterData.unit.id } }),
      prismaClient.masterJobPosition.delete({ where: { id: masterData.position.id } }),
      prismaClient.masterJobLevel.delete({ where: { id: masterData.level.id } }),
      prismaClient.masterBuilding.delete({ where: { id: masterData.building.id } }),
    ]);
    personIds.length = 0;
    adminIds.length = 0;
    apiClientIds.length = 0;
    entitlementIds.length = 0;
  });

  async function createEmployee(status: EmployeeStatus = EmployeeStatus.ACTIVE) {
    const person = await EmployeeTest.create({
      email: `test_entitlement_${fixtureKey}_${personIds.length}@millennia21.id`,
      unitId: masterData.unit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
      employeeId: `99.99.entitlement.${fixtureKey}.${personIds.length}`,
      status,
    });
    personIds.push(person.id);
    return person;
  }

  async function createSuperAdmin() {
    const id = `test-entitlement-admin-${fixtureKey}-${adminIds.length}`;
    const admin = await AdminUserTest.createSuperAdmin(masterData.unit.id, {
      id,
      email: `${id}@millennia21.id`,
    });
    adminIds.push(id);
    return admin;
  }

  async function createDatabaseAdmin() {
    const id = `test-entitlement-db-admin-${fixtureKey}`;
    const admin = await AdminUserTest.createDatabaseAdmin(masterData.unit.id, {
      id,
      email: `${id}@millennia21.id`,
    });
    adminIds.push(id);
    return admin;
  }

  async function createApiClient(scopeNames: string[]) {
    const result = await ApiClientTest.createWithToken({
      name: `TEST_ENTITLEMENT_CLIENT_${fixtureKey}_${apiClientIds.length}`,
      scopeNames,
    });
    apiClientIds.push(result.client.id);
    return result;
  }

  async function responseData(response: Response) {
    const body = await response.json();
    if (response.ok && body.data?.id) entitlementIds.push(body.data.id);
    return body.data;
  }

  it("requires the application entitlement API scope", async () => {
    const person = await createEmployee();
    const { token } = await createApiClient(["employees:read"]);
    const response = await TestRequest.get(
      `/api/internal/application-entitlements/lookup?person_id=${person.id}&application_id=exima`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    expect(response.status).toBe(403);
  });

  it("lists the application ids set up in Application Access, with the read scope only", async () => {
    const denied = await createApiClient(["employees:read"]);
    const refused = await TestRequest.get("/api/internal/application-entitlements/applications", undefined, {
      Authorization: `Bearer ${denied.token}`,
    });
    expect(refused.status).toBe(403);

    const { token } = await createApiClient([API_SCOPES.APPLICATION_ENTITLEMENTS_READ]);
    const response = await TestRequest.get("/api/internal/application-entitlements/applications", undefined, {
      Authorization: `Bearer ${token}`,
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toContain("exima");
  });

  it("grants and looks up an entitlement by stable Person.id without using email", async () => {
    const person = await createEmployee();
    const { accessToken } = await createSuperAdmin();
    const grantResponse = await TestRequest.post(
      "/api/admin/application-entitlements",
      {
        person_id: person.id,
        application_id: "exima",
        role: "ADMIN",
        permissions: ADMIN_PERMISSIONS,
      },
      accessToken,
    );
    const grantData = await responseData(grantResponse);
    expect(grantResponse.status).toBe(200);
    expect(grantData.person_id).toBe(person.id);
    expect(grantData.version).toBe(1);

    await prismaClient.person.update({
      where: { id: person.id },
      data: { email: `renamed_${Date.now()}@millennia21.id` },
    });
    const { token } = await createApiClient([API_SCOPES.APPLICATION_ENTITLEMENTS_READ]);
    const lookupResponse = await TestRequest.get(
      `/api/internal/application-entitlements/lookup?person_id=${person.id}&application_id=exima`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    const lookupBody = await lookupResponse.json();
    expect(lookupResponse.status).toBe(200);
    expect(lookupBody.data.person_id).toBe(person.id);
    expect(lookupBody.data.application_id).toBe("exima");
    expect(lookupBody.data.email).toBeUndefined();

    const audit = await prismaClient.auditLog.findFirst({
      where: { action: AuditAction.API_ACCESS, entity_id: grantData.id },
    });
    expect(audit?.api_client_id).toBeDefined();
  });

  it("revokes transactionally and increments the version", async () => {
    const person = await createEmployee();
    const { accessToken } = await createSuperAdmin();
    const grant = await TestRequest.post(
      "/api/admin/application-entitlements",
      {
        person_id: person.id,
        application_id: "exima",
        role: "STAFF",
        permissions: STAFF_PERMISSIONS,
      },
      accessToken,
    );
    const granted = await responseData(grant);
    const revoke = await TestRequest.patch(
      `/api/admin/application-entitlements/revoke/${granted.id}`,
      {},
      accessToken,
    );
    const body = await revoke.json();
    expect(revoke.status).toBe(200);
    expect(body.data.is_active).toBe(false);
    expect(body.data.version).toBe(2);
    expect(
      await prismaClient.auditLog.findFirst({
        where: {
          action: AuditAction.APPLICATION_ENTITLEMENT_REVOKE,
          entity_id: granted.id,
        },
      }),
    ).not.toBeNull();
  });

  it("updates and lists entitlements for Super Admin only", async () => {
    const person = await createEmployee();
    const { accessToken } = await createSuperAdmin();
    const grant = await TestRequest.post(
      "/api/admin/application-entitlements",
      {
        person_id: person.id,
        application_id: "exima",
        role: "STAFF",
        permissions: STAFF_PERMISSIONS,
      },
      accessToken,
    );
    const granted = await responseData(grant);

    const update = await TestRequest.patch(
      `/api/admin/application-entitlements/${granted.id}`,
      { role: "ADMIN", permissions: ADMIN_PERMISSIONS },
      accessToken,
    );
    const updated = (await update.json()).data;
    expect(update.status).toBe(200);
    expect(updated.role).toBe("ADMIN");
    expect(updated.permissions).toEqual(ADMIN_PERMISSIONS);
    expect(updated.version).toBe(2);

    const list = await TestRequest.get(
      `/api/admin/application-entitlements?person_id=${person.id}&application_id=exima&is_active=true`,
      accessToken,
    );
    const listed = (await list.json()).data;
    expect(list.status).toBe(200);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(granted.id);

    const databaseAdmin = await createDatabaseAdmin();
    const forbidden = await TestRequest.get(
      "/api/admin/application-entitlements",
      databaseAdmin.accessToken,
    );
    expect(forbidden.status).toBe(403);
  });

  it("rejects inactive employees at grant and runtime lookup", async () => {
    const inactive = await createEmployee(EmployeeStatus.INACTIVE);
    const { accessToken } = await createSuperAdmin();
    const grant = await TestRequest.post(
      "/api/admin/application-entitlements",
      {
        person_id: inactive.id,
        application_id: "exima",
        role: "STAFF",
        permissions: STAFF_PERMISSIONS,
      },
      accessToken,
    );
    expect(grant.status).toBe(404);

    await prismaClient.applicationEntitlement.create({
      data: {
        person_id: inactive.id,
        application_id: "exima",
        organization_id: "mws",
        role: "STAFF",
        permissions: STAFF_PERMISSIONS,
      },
    });
    const stored = await prismaClient.applicationEntitlement.findUniqueOrThrow({
      where: { person_id_application_id: { person_id: inactive.id, application_id: "exima" } },
    });
    entitlementIds.push(stored.id);
    const { token } = await createApiClient([API_SCOPES.APPLICATION_ENTITLEMENTS_READ]);
    const lookup = await TestRequest.get(
      `/api/internal/application-entitlements/lookup?person_id=${inactive.id}&application_id=exima`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    expect(lookup.status).toBe(404);
  });

  it("rejects Exima roles or permissions outside the canonical policy", async () => {
    const person = await createEmployee();
    const { accessToken } = await createSuperAdmin();
    const response = await TestRequest.post(
      "/api/admin/application-entitlements",
      {
        person_id: person.id,
        application_id: "exima",
        role: "VIEWER",
        permissions: ["reports.read"],
      },
      accessToken,
    );
    expect(response.status).toBe(400);
  });

  it("accepts every canonical Daily Check-in role bundle", async () => {
    const { accessToken } = await createSuperAdmin();

    for (const [role, permissions] of Object.entries(DAILY_CHECKIN_PERMISSIONS)) {
      const person = await createEmployee();
      const response = await TestRequest.post(
        "/api/admin/application-entitlements",
        {
          person_id: person.id,
          application_id: "daily-checkin",
          role,
          permissions,
        },
        accessToken,
      );
      const data = await responseData(response);
      expect(response.status).toBe(200);
      expect(data.role).toBe(role);
      expect(data.permissions).toEqual(permissions);
    }
  });

  it("rejects Daily Check-in unsupported roles and non-exact bundles", async () => {
    const { accessToken } = await createSuperAdmin();
    const cases = [
      { role: "VIEWER", permissions: DAILY_CHECKIN_PERMISSIONS.PARTICIPANT },
      { role: "PARTICIPANT", permissions: DAILY_CHECKIN_PERMISSIONS.PARTICIPANT.slice(1) },
      { role: "EDUCATOR", permissions: [...DAILY_CHECKIN_PERMISSIONS.EDUCATOR, "dashboard.read"] },
    ];

    for (const testCase of cases) {
      const person = await createEmployee();
      const response = await TestRequest.post(
        "/api/admin/application-entitlements",
        {
          person_id: person.id,
          application_id: "daily-checkin",
          ...testCase,
        },
        accessToken,
      );
      expect(response.status).toBe(400);
    }
  });
  it("is strict about role keys: lowercase and unknown roles are rejected, permissions default from the registry", async () => {
    const { accessToken } = await createSuperAdmin();
    const base = { application_id: "exima" };

    const lower = await TestRequest.post(
      "/api/admin/application-entitlements",
      { ...base, person_id: (await createEmployee()).id, role: "admin" },
      accessToken,
    );
    expect(lower.status).toBe(400);

    const unknown = await TestRequest.post(
      "/api/admin/application-entitlements",
      { ...base, person_id: (await createEmployee()).id, role: "MANAGER" },
      accessToken,
    );
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).errors).toContain("not an active role");

    const defaulted = await TestRequest.post(
      "/api/admin/application-entitlements",
      { ...base, person_id: (await createEmployee()).id, role: "STAFF" },
      accessToken,
    );
    const data = await responseData(defaulted);
    expect(defaulted.status).toBe(200);
    expect(data.permissions).toEqual(STAFF_PERMISSIONS);
  });

  it("pages and filters the entitlement list with the person's name and unit", async () => {
    const { accessToken } = await createSuperAdmin();
    for (const role of ["STAFF", "STAFF", "CASHIER"]) {
      const response = await TestRequest.post(
        "/api/admin/application-entitlements",
        {
          person_id: (await createEmployee()).id,
          application_id: "exima",
          role,
        },
        accessToken,
      );
      await responseData(response);
    }

    const paged = await (await TestRequest.get(
      "/api/admin/application-entitlements?application_id=exima&size=2",
      accessToken,
    )).json();
    expect(paged.data).toHaveLength(2);
    expect(paged.paging.total_item).toBe(3);
    expect(paged.data[0].person.unit).toBe(`TEST_ENTITLEMENT_UNIT_${fixtureKey}`);

    const cashiers = await (await TestRequest.get(
      "/api/admin/application-entitlements?application_id=exima&role=CASHIER",
      accessToken,
    )).json();
    expect(cashiers.data).toHaveLength(1);

    const searched = await (await TestRequest.get(
      `/api/admin/application-entitlements?application_id=exima&search=nomatch_${fixtureKey}`,
      accessToken,
    )).json();
    expect(searched.data).toHaveLength(0);
  });
});
