import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AcademicYearStatus, ClassStatus } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ApiClientTest, MasterDataTest, TestRequest } from "./test-utils";

const READ_SCOPE = "classes:read";

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("Class API (internal)", () => {
  async function cleanup() {
    await prismaClient.class.deleteMany({
      where: { name: { startsWith: "TEST_API_CLASS_" } },
    });
    await prismaClient.grade.deleteMany({
      where: { name: { startsWith: "TEST_API_GRADE_" } },
    });
    await prismaClient.academicYear.deleteMany({
      where: { name: { startsWith: "TEST_API_YEAR_" } },
    });
    await ApiClientTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  async function createClass(unitId: string, status: ClassStatus = ClassStatus.ACTIVE) {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const academicYear =
      (await prismaClient.academicYear.findFirst({
        where: { status: AcademicYearStatus.ACTIVE },
      })) ??
      (await prismaClient.academicYear.create({
        data: {
          name: `TEST_API_YEAR_${suffix}`,
          status: AcademicYearStatus.ACTIVE,
          start_date: new Date("2026-07-01"),
        },
      }));
    const grade = await prismaClient.grade.create({
      data: {
        name: `TEST_API_GRADE_${suffix}`,
        level: 7000 + Math.floor(Math.random() * 1000),
        unit_id: unitId,
      },
    });
    return prismaClient.class.create({
      data: {
        name: `TEST_API_CLASS_${suffix}`,
        grade_id: grade.id,
        academic_year_id: academicYear.id,
        status,
      },
    });
  }

  it("returns an active class even when it has no teacher assigned", async () => {
    const masterData = await MasterDataTest.create();
    const klass = await createClass(masterData.unit.id);
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.get(
      "/api/internal/classes?size=100",
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const found = body.data.find(
      (item: { class_id: string }) => item.class_id === klass.id,
    );
    expect(found).toBeDefined();
    expect(found.class_name).toBe(klass.name);
    expect(found.unit_name).toBe(masterData.unit.name);
    expect(found.academic_year_id).toBe(klass.academic_year_id);
    expect(found.academic_year_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("excludes an INACTIVE class", async () => {
    const masterData = await MasterDataTest.create();
    const klass = await createClass(masterData.unit.id, ClassStatus.INACTIVE);
    const { token } = await ApiClientTest.createWithToken({
      scopeNames: [READ_SCOPE],
    });

    const response = await TestRequest.get(
      "/api/internal/classes?size=100",
      undefined,
      authHeader(token),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.some((item: { class_id: string }) => item.class_id === klass.id),
    ).toBe(false);
  });

  it("rejects a request without the classes:read scope", async () => {
    const { token } = await ApiClientTest.createWithToken({ scopeNames: [] });

    const response = await TestRequest.get(
      "/api/internal/classes",
      undefined,
      authHeader(token),
    );

    expect(response.status).toBe(403);
  });
});
