import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { prismaClient } from "../lib/prisma";
import { ApiClientTest, EmployeeTest, MasterDataTest, TestRequest } from "./test-utils";

const READ_SCOPE = "employees:read";
const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("GET /api/internal/organization-units", () => {
  beforeEach(async () => {
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  });

  afterEach(async () => {
    await EmployeeTest.delete();
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  });

  it("lists units even when they have no active employees", async () => {
    const { unit } = await MasterDataTest.create();
    const emptyUnit = await prismaClient.masterUnit.create({ data: { name: "TEST_UNIT_EMPTY" } });
    const { token } = await ApiClientTest.createWithToken({ scopeNames: [READ_SCOPE] });

    const response = await TestRequest.get("/api/internal/organization-units", undefined, authHeader(token));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: unit.id, name: unit.name }),
      expect.objectContaining({ id: emptyUnit.id, name: emptyUnit.name }),
    ]));
  });

  it("moves the directory version when a unit is renamed", async () => {
    const { unit } = await MasterDataTest.create();
    const { token } = await ApiClientTest.createWithToken({ scopeNames: [READ_SCOPE] });
    const before = await (
      await TestRequest.get("/api/internal/organization-units/version", undefined, authHeader(token))
    ).json();

    await prismaClient.masterUnit.update({ where: { id: unit.id }, data: { name: "TEST_UNIT_RENAMED" } });
    const after = await (
      await TestRequest.get("/api/internal/organization-units/version", undefined, authHeader(token))
    ).json();

    expect(after.data.total).toBe(before.data.total);
    expect(after.data.key).not.toBe(before.data.key);
  });

  it("requires employees:read", async () => {
    const { token } = await ApiClientTest.createWithToken({ scopeNames: ["students:read"] });
    const response = await TestRequest.get("/api/internal/organization-units", undefined, authHeader(token));
    expect(response.status).toBe(403);
  });
});
