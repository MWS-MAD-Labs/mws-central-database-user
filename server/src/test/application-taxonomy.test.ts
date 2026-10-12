import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";
import { API_SCOPES } from "../constants/api-scopes";
import { prismaClient } from "../lib/prisma";
import { AdminUserTest, ApiClientTest, AuditLogTest, MasterDataTest, TestRequest } from "./test-utils";

const ACCESS = "/api/admin/application-access";

describe("application scopes and categories", () => {
  const suffix = randomBytes(3).toString("hex");
  const scopeName = `TEST Scope ${suffix}`;
  const scopeKey = `test-scope-${suffix}`;
  let appId: string;

  beforeEach(async () => {
    appId = `test-tax-${suffix}`;
    await MasterDataTest.create();
  });

  afterEach(async () => {
    await prismaClient.application.deleteMany({ where: { application_id: appId } });
    await prismaClient.applicationScope.deleteMany({ where: { key: { startsWith: "test-" } } });
    await prismaClient.applicationCategory.deleteMany({ where: { key: { startsWith: "test-" } } });
    await AuditLogTest.delete();
    await ApiClientTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("starts with the categories the Hub always had and the four spaces", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const response = await TestRequest.get(`${ACCESS}/taxonomy`, accessToken);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.categories.map((item: { key: string }) => item.key).slice(0, 5)).toEqual([
      "reporting", "students", "workplace", "operations", "utilities",
    ]);
    expect(data.scopes.map((item: { key: string }) => item.key).slice(0, 4)).toEqual([
      "safespace", "learnspace", "carespace", "shieldspace",
    ]);
  });

  it("makes the key from the name once and keeps it when the name changes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const created = await TestRequest.post("/api/admin/application-scopes", { name: scopeName }, accessToken);
    expect(created.status).toBe(200);
    const row = (await created.json()).data;
    expect(row.key).toBe(scopeKey);

    const renamed = await TestRequest.patch(`/api/admin/application-scopes/${row.id}`, { name: `${scopeName} Renamed` }, accessToken);
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).data.key).toBe(scopeKey);

    // A name that makes the same key is refused.
    const similar = await TestRequest.post("/api/admin/application-scopes", { name: scopeName.toUpperCase() }, accessToken);
    expect(similar.status).toBe(400);
    const nothing = await TestRequest.post("/api/admin/application-categories", { name: "!!!" }, accessToken);
    expect(nothing.status).toBe(400);
  });

  it("only a Super Admin can change the lists", async () => {
    const { accessToken } = await AdminUserTest.createDatabaseAdmin();
    const response = await TestRequest.post("/api/admin/application-categories", { name: "TEST Nope" }, accessToken);
    expect(response.status).toBe(403);
  });

  it("puts an application in a category and a scope, refuses unknown ones, and blocks deleting what is used", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const scope = (await (await TestRequest.post("/api/admin/application-scopes", { name: scopeName }, accessToken)).json()).data;

    const bad = await TestRequest.post(
      `${ACCESS}/applications`,
      { application_id: appId, name: "TEST_Tax", launch_url: "https://tax.example.com/sso", scope: "nowhere" },
      accessToken,
    );
    expect(bad.status).toBe(400);

    const ok = await TestRequest.post(
      `${ACCESS}/applications`,
      { application_id: appId, name: "TEST_Tax", launch_url: "https://tax.example.com/sso", category: "reporting", scope: scopeKey },
      accessToken,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.scope).toBe(scopeKey);
    expect(await prismaClient.application.findUniqueOrThrow({ where: { application_id: appId } })).toMatchObject({
      category: "reporting",
      scope: scopeKey,
    });

    const used = await TestRequest.delete(`/api/admin/application-scopes/${scope.id}`, accessToken);
    expect(used.status).toBe(400);
    expect((await used.json()).errors).toContain("1 application(s)");

    const cleared = await TestRequest.patch(`${ACCESS}/apps/${appId}/details`, { scope: "" }, accessToken);
    expect(cleared.status).toBe(200);
    expect((await TestRequest.delete(`/api/admin/application-scopes/${scope.id}`, accessToken)).status).toBe(200);
  });

  it("gives the Hub both lists, and the scope of each published application", async () => {
    const { token } = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.APPLICATION_ENTITLEMENTS_READ] });
    const response = await TestRequest.get("/api/internal/application-taxonomy", undefined, { Authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.categories.some((item: { key: string }) => item.key === "utilities")).toBe(true);
    expect(data.scopes.some((item: { key: string }) => item.key === "safespace")).toBe(true);

    const wrong = await ApiClientTest.createWithToken({ scopeNames: [API_SCOPES.EMPLOYEES_READ] });
    expect(
      (await TestRequest.get("/api/internal/application-taxonomy", undefined, { Authorization: `Bearer ${wrong.token}` })).status,
    ).toBe(403);
  });
});
