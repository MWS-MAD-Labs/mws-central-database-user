import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AcademicYearStatus, AuditAction } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { defaultSemesterDates } from "../service/academic-semester-service";
import { AcademicYearTest, AdminUserTest, ApiClientTest, MasterDataTest, TestRequest } from "./test-utils";

const YEAR = new Date().getFullYear() + 20;
const YEAR_NAME = `${YEAR}/${YEAR + 1}`;
const BASE = "/api/admin/academic-years";
const iso = (value: string) => new Date(value).toISOString();

async function makeYear() {
  return prismaClient.academicYear.create({
    data: {
      name: YEAR_NAME,
      start_date: new Date(`${YEAR}-07-01`),
      end_date: new Date(`${YEAR + 1}-06-30`),
      status: AcademicYearStatus.UPCOMING,
    },
  });
}

async function cleanup() {
  await AcademicYearTest.delete();
  await ApiClientTest.delete();
  await AdminUserTest.delete();
  await MasterDataTest.delete();
}

describe("academic semesters", () => {
  beforeEach(async () => {
    await cleanup();
    await MasterDataTest.create();
  });
  afterEach(cleanup);

  it("splits a year into two halves without a gap or an overlap", () => {
    const [first, second] = defaultSemesterDates(new Date("2026-07-01"), new Date("2027-06-30"));
    expect(first.start_date.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(second.end_date.toISOString().slice(0, 10)).toBe("2027-06-30");
    expect(second.start_date.getTime() - first.end_date.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(first.name).toBe("Semester 1");
  });

  it("adds, lists, changes and deletes a semester as a Super Admin, with the audit log", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await makeYear();
    const created = await TestRequest.post(
      `${BASE}/${year.id}/semesters`,
      { name: "Semester 1", start_date: iso(`${YEAR}-07-01`), end_date: iso(`${YEAR}-12-20`) },
      accessToken,
    );
    const body = await created.json();
    expect(created.status).toBe(200);
    expect(body.data).toMatchObject({ name: "Semester 1", position: 1 });

    const listed = await (await TestRequest.get(`${BASE}/${year.id}/semesters`, accessToken)).json();
    expect(listed.data.map((row: { name: string }) => row.name)).toEqual(["Semester 1"]);

    const changed = await TestRequest.patch(
      `${BASE}/semesters/${body.data.id}`,
      { name: "First Semester" },
      accessToken,
    );
    expect((await changed.json()).data.name).toBe("First Semester");

    const removed = await TestRequest.delete(`${BASE}/semesters/${body.data.id}`, accessToken);
    expect(removed.status).toBe(200);
    expect(await prismaClient.academicSemester.count({ where: { academic_year_id: year.id } })).toBe(0);
    const actions = (
      await prismaClient.auditLog.findMany({ where: { entity_id: body.data.id }, orderBy: { created_at: "asc" } })
    ).map((row) => row.action);
    expect(actions).toEqual([
      AuditAction.CREATE_ACADEMIC_SEMESTER,
      AuditAction.UPDATE_ACADEMIC_SEMESTER,
      AuditAction.DELETE_ACADEMIC_SEMESTER,
    ]);
  });

  it("refuses dates outside the year, overlaps, a repeated name and a second admin kind", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await makeYear();
    const add = (name: string, from: string, to: string, token = accessToken) =>
      TestRequest.post(`${BASE}/${year.id}/semesters`, { name, start_date: iso(from), end_date: iso(to) }, token);
    expect((await add("Early", `${YEAR}-06-01`, `${YEAR}-08-01`)).status).toBe(400);
    expect((await add("Late", `${YEAR}-07-01`, `${YEAR + 1}-08-01`)).status).toBe(400);
    expect((await add("Backwards", `${YEAR}-09-01`, `${YEAR}-08-01`)).status).toBe(400);
    expect((await add("Semester 1", `${YEAR}-07-01`, `${YEAR}-12-20`)).status).toBe(200);
    expect((await add("Clash", `${YEAR}-12-01`, `${YEAR + 1}-02-01`)).status).toBe(400);
    expect((await add("semester 1", `${YEAR + 1}-01-05`, `${YEAR + 1}-06-30`)).status).toBe(400);
    const { accessToken: other } = await AdminUserTest.createDatabaseAdmin();
    expect((await add("Semester 2", `${YEAR + 1}-01-05`, `${YEAR + 1}-06-30`, other)).status).toBe(403);
  });

  it("fills Semester 1 and Semester 2 once", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await makeYear();
    const first = await TestRequest.post(`${BASE}/${year.id}/semesters/defaults`, {}, accessToken);
    expect(first.status).toBe(200);
    expect((await first.json()).data.map((row: { name: string }) => row.name)).toEqual(["Semester 1", "Semester 2"]);
    expect((await TestRequest.post(`${BASE}/${year.id}/semesters/defaults`, {}, accessToken)).status).toBe(400);
  });

  it("does not let the year shrink past a semester, and deletes them with the year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await makeYear();
    await TestRequest.post(`${BASE}/${year.id}/semesters/defaults`, {}, accessToken);
    const shrink = await TestRequest.patch(
      `${BASE}/${year.id}`,
      { end_date: iso(`${YEAR + 1}-03-01`) },
      accessToken,
    );
    expect(shrink.status).toBe(400);
    expect((await shrink.json()).errors).toContain("Semester 2");
    await prismaClient.academicYear.delete({ where: { id: year.id } });
    expect(await prismaClient.academicSemester.count({ where: { academic_year_id: year.id } })).toBe(0);
  });

  it("is read by an application with the class scope, for the active year only", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await makeYear();
    await TestRequest.post(`${BASE}/${year.id}/semesters/defaults`, {}, accessToken);
    const { token } = await ApiClientTest.createWithToken({ scopeNames: ["classes:read"] });
    const headers = { Authorization: `Bearer ${token}` };
    const upcoming = await (await TestRequest.get("/api/internal/academic-years", undefined, headers)).json();
    expect(upcoming.data.some((row: { academic_year: string }) => row.academic_year === YEAR_NAME)).toBe(false);

    const active = await prismaClient.academicYear.findFirst({ where: { status: AcademicYearStatus.ACTIVE } });
    if (active) return;
    await prismaClient.academicYear.update({ where: { id: year.id }, data: { status: AcademicYearStatus.ACTIVE } });
    const body = await (await TestRequest.get("/api/internal/academic-years", undefined, headers)).json();
    const row = body.data.find((item: { academic_year: string }) => item.academic_year === YEAR_NAME);
    expect(row.semesters.map((item: { name: string }) => item.name)).toEqual(["Semester 1", "Semester 2"]);
    expect(row.semesters[0].start_date).toBe(`${YEAR}-07-01`);

    const { token: noScope } = await ApiClientTest.createWithToken({ scopeNames: ["students:read"], name: "TEST_NOSCOPE" } as never);
    expect((await TestRequest.get("/api/internal/academic-years", undefined, { Authorization: `Bearer ${noScope}` })).status).toBe(403);
  });
});
