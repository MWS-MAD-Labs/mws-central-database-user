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

  it("makes the semesters with the year: given, by default, or none", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const body = {
      name: YEAR_NAME,
      start_date: iso(`${YEAR}-07-01`),
      end_date: iso(`${YEAR + 1}-06-30`),
      status: "UPCOMING",
    };
    const bad = await TestRequest.post(
      BASE,
      {
        ...body,
        semesters: [
          { name: "Semester 1", start_date: iso(`${YEAR}-07-01`), end_date: iso(`${YEAR}-12-31`) },
          { name: "Semester 2", start_date: iso(`${YEAR}-12-01`), end_date: iso(`${YEAR + 1}-06-30`) },
        ],
      },
      accessToken,
    );
    expect(bad.status).toBe(400);
    expect(await prismaClient.academicYear.count({ where: { name: YEAR_NAME } })).toBe(0);

    const given = await TestRequest.post(
      BASE,
      {
        ...body,
        semesters: [
          { name: "Ganjil", start_date: iso(`${YEAR}-07-01`), end_date: iso(`${YEAR}-12-31`) },
          { name: "Genap", start_date: iso(`${YEAR + 1}-01-05`), end_date: iso(`${YEAR + 1}-06-30`) },
        ],
      },
      accessToken,
    );
    expect(given.status).toBe(200);
    const id = (await given.json()).data.id;
    const rows = await prismaClient.academicSemester.findMany({ where: { academic_year_id: id }, orderBy: { position: "asc" } });
    expect(rows.map((row) => row.name)).toEqual(["Ganjil", "Genap"]);
    await prismaClient.academicYear.delete({ where: { id } });

    const byDefault = await TestRequest.post(BASE, body, accessToken);
    const defaultId = (await byDefault.json()).data.id;
    const made = await prismaClient.academicSemester.findMany({ where: { academic_year_id: defaultId }, orderBy: { position: "asc" } });
    expect(made.map((row) => row.name)).toEqual(["Semester 1", "Semester 2"]);
    await prismaClient.academicYear.delete({ where: { id: defaultId } });

    const none = await TestRequest.post(BASE, { ...body, semesters: [] }, accessToken);
    const noneId = (await none.json()).data.id;
    expect(await prismaClient.academicSemester.count({ where: { academic_year_id: noneId } })).toBe(0);
  });

  it("changes the semesters with the year: edit, add, remove, swap names", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await makeYear();
    const patch = (semesters: unknown[], extra: Record<string, unknown> = {}) =>
      TestRequest.patch(`${BASE}/${year.id}`, { semesters, ...extra }, accessToken);
    const item = (name: string, from: string, to: string, id?: string) => ({
      ...(id ? { id } : {}),
      name,
      start_date: iso(from),
      end_date: iso(to),
    });
    const names = async () =>
      (await prismaClient.academicSemester.findMany({ where: { academic_year_id: year.id }, orderBy: { position: "asc" } })).map(
        (row) => row.name,
      );

    expect((await patch([item("Semester 1", `${YEAR}-07-01`, `${YEAR}-12-20`), item("Semester 2", `${YEAR + 1}-01-05`, `${YEAR + 1}-06-30`)])).status).toBe(200);
    expect(await names()).toEqual(["Semester 1", "Semester 2"]);
    const rows = await prismaClient.academicSemester.findMany({ where: { academic_year_id: year.id }, orderBy: { position: "asc" } });

    // swap the names and move a date
    expect(
      (await patch([item("Semester 2", `${YEAR}-07-01`, `${YEAR}-12-31`, rows[0].id), item("Semester 1", `${YEAR + 1}-01-05`, `${YEAR + 1}-06-30`, rows[1].id)])).status,
    ).toBe(200);
    expect(await names()).toEqual(["Semester 2", "Semester 1"]);

    // leaving one out removes it
    expect((await patch([item("Semester 2", `${YEAR}-07-01`, `${YEAR}-12-31`, rows[0].id)])).status).toBe(200);
    expect(await names()).toEqual(["Semester 2"]);

    // outside the year, overlapping or a repeated name is refused and nothing changes
    expect((await patch([item("Early", `${YEAR}-06-01`, `${YEAR}-08-01`, rows[0].id)])).status).toBe(400);
    expect((await patch([item("A", `${YEAR}-07-01`, `${YEAR}-12-31`, rows[0].id), item("B", `${YEAR}-12-01`, `${YEAR + 1}-02-01`)])).status).toBe(400);
    expect((await patch([item("A", `${YEAR}-07-01`, `${YEAR}-09-30`, rows[0].id), item("a", `${YEAR}-10-01`, `${YEAR}-12-31`)])).status).toBe(400);
    expect(await names()).toEqual(["Semester 2"]);

    const { accessToken: other } = await AdminUserTest.createDatabaseAdmin();
    expect((await TestRequest.patch(`${BASE}/${year.id}`, { semesters: [] }, other)).status).toBe(403);
    expect((await TestRequest.patch(`${BASE}/${year.id}`, { semesters: [] }, accessToken)).status).toBe(200);
    expect(await names()).toEqual([]);

    const actions = (await prismaClient.auditLog.findMany({ where: { entity_type: "AcademicSemester" } })).map((row) => row.action);
    expect(actions).toContain(AuditAction.CREATE_ACADEMIC_SEMESTER);
    expect(actions).toContain(AuditAction.UPDATE_ACADEMIC_SEMESTER);
    expect(actions).toContain(AuditAction.DELETE_ACADEMIC_SEMESTER);
  });

  it("does not let the year shrink past a semester, and deletes them with the year", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const created = await TestRequest.post(
      BASE,
      { name: YEAR_NAME, start_date: iso(`${YEAR}-07-01`), end_date: iso(`${YEAR + 1}-06-30`), status: "UPCOMING" },
      accessToken,
    );
    const id = (await created.json()).data.id;
    const shrink = await TestRequest.patch(`${BASE}/${id}`, { end_date: iso(`${YEAR + 1}-03-01`) }, accessToken);
    expect(shrink.status).toBe(400);
    expect((await shrink.json()).errors).toContain("Semester 2");
    await prismaClient.academicYear.delete({ where: { id } });
    expect(await prismaClient.academicSemester.count({ where: { academic_year_id: id } })).toBe(0);
  });

  it("is read by an application with the class scope, for the active year only", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const year = await makeYear();
    await prismaClient.academicSemester.createMany({
      data: [
        { academic_year_id: year.id, name: "Semester 1", position: 1, start_date: new Date(`${YEAR}-07-01`), end_date: new Date(`${YEAR}-12-31`) },
        { academic_year_id: year.id, name: "Semester 2", position: 2, start_date: new Date(`${YEAR + 1}-01-01`), end_date: new Date(`${YEAR + 1}-06-30`) },
      ],
    });
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
