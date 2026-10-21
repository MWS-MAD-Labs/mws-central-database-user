import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AdminUserTest,
  AuditLogTest,
  EmployeeTest,
  MasterDataTest,
  TestRequest,
} from "./test-utils";
import {
  AuditAction,
  ChildRelation,
  EmployeeStatus,
  EmploymentType,
  Gender,
  MaritalStatus,
  Religion,
  type MasterBuilding,
  type MasterJobLevel,
  type MasterJobPosition,
  type MasterUnit,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";

// Date-only text for someone who is `years` years and `extraDays` days old today.
const yearsAgo = (years: number, extraDays = 0) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - extraDays));
  return date.toISOString().slice(0, 10);
};

describe("employee children", () => {
  let master: { unit: MasterUnit; position: MasterJobPosition; level: MasterJobLevel; building: MasterBuilding };
  let seq = 0;

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    master = await MasterDataTest.create();
  });
  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  const employeeBody = (over: Record<string, unknown> = {}) => {
    seq += 1;
    return {
      full_name: "Child Test Parent",
      nick_name: "Parent",
      email: `test_children_${seq}@millennia21.id`,
      gender: Gender.FEMALE,
      religion: Religion.ISLAM,
      birth_place: "Jakarta",
      // 40 years old.
      birth_date: `${yearsAgo(40)}T00:00:00.000Z`,
      employee_id: `99.99.9${String(seq).padStart(2, "0")}`,
      marital_status: MaritalStatus.MARRIED,
      status: EmployeeStatus.ACTIVE,
      employment_type: EmploymentType.PERMANENT,
      unit_id: master.unit.id,
      job_position_id: master.position.id,
      job_level_id: master.level.id,
      building_id: master.building.id,
      join_date: new Date("2026-01-01").toISOString(),
      ...over,
    };
  };

  const create = async (token: string, over: Record<string, unknown> = {}) => {
    const response = await TestRequest.post("/api/admin/employees", employeeBody(over), token);
    return { response, body: await response.json() };
  };

  const reveal = async (token: string, id: string) => {
    const response = await TestRequest.post(`/api/admin/employees/${id}/sensitive-fields/access`, {}, token);
    return (await response.json()).data;
  };

  it("keeps the children out of the plain detail and gives them, with the numbers, only on reveal", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { response, body } = await create(accessToken, {
      children: [
        { birth_date: yearsAgo(10) },
        { birth_date: yearsAgo(22, 100), relation: ChildRelation.ADOPTED },
      ],
    });
    expect(response.status).toBe(200);

    const plain = await (await TestRequest.get(`/api/admin/employees/${body.data.id}`, accessToken)).json();
    expect(plain.data.identity.children).toBeUndefined();

    const revealed = await reveal(accessToken, body.data.id);
    expect(revealed.children.summary).toEqual({ total: 2, under_23: 2, age_23_plus: 0, allowance_eligible: 2 });
    expect(revealed.children.items.map((item: { relation: string }) => item.relation)).toEqual(["ADOPTED", "BIOLOGICAL"]);
  });

  it("splits the children at 23 by their birth dates", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { body } = await create(accessToken, {
      birth_date: `${yearsAgo(60)}T00:00:00.000Z`,
      children: [{ birth_date: yearsAgo(23) }, { birth_date: yearsAgo(23, -1) }, { birth_date: yearsAgo(30) }],
    });
    const revealed = await reveal(accessToken, body.data.id);
    // Exactly 23 today is no longer under 23; one day short of 23 still is.
    expect(revealed.children.summary).toMatchObject({ total: 3, under_23: 1, age_23_plus: 2 });
  });

  it("rejects a 20 year old child of a 30 year old", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { response, body } = await create(accessToken, {
      birth_date: `${yearsAgo(30)}T00:00:00.000Z`,
      children: [{ birth_date: yearsAgo(20) }],
    });
    expect(response.status).toBe(400);
    expect(body.errors).toContain("at least 18 years younger");
  });

  it("lets a single employee have an adopted child and not a biological one", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const rejected = await create(accessToken, {
      marital_status: MaritalStatus.SINGLE,
      children: [{ birth_date: yearsAgo(5) }],
    });
    expect(rejected.response.status).toBe(400);
    expect(rejected.body.errors).toContain("single");

    const accepted = await create(accessToken, {
      marital_status: MaritalStatus.SINGLE,
      children: [{ birth_date: yearsAgo(5), relation: ChildRelation.ADOPTED }],
    });
    expect(accepted.response.status).toBe(200);
  });

  it("needs the employee PII permission to write children", async () => {
    const blocked = await AdminUserTest.createDatabaseAdmin(master.unit.id);
    const denied = await create(blocked.accessToken, { children: [{ birth_date: yearsAgo(5) }] });
    expect(denied.response.status).toBe(403);
    expect(denied.body.errors).toContain("employee PII");

    await AdminUserTest.delete();
    const allowed = await AdminUserTest.createDatabaseAdmin(master.unit.id, { canViewEmployeePii: true });
    const ok = await create(allowed.accessToken, { children: [{ birth_date: yearsAgo(5) }] });
    expect(ok.response.status).toBe(200);
  });

  it("replaces the whole list on update, keeps it when children is not sent, and clears it with an empty list", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { body } = await create(accessToken, { children: [{ birth_date: yearsAgo(5) }, { birth_date: yearsAgo(8) }] });
    const id = body.data.id as string;

    await TestRequest.patch(`/api/admin/employees/${id}`, { notes: "no change to children" }, accessToken);
    expect((await reveal(accessToken, id)).children.summary.total).toBe(2);

    const replaced = await TestRequest.patch(`/api/admin/employees/${id}`, { children: [{ birth_date: yearsAgo(3) }] }, accessToken);
    expect(replaced.status).toBe(200);
    expect((await reveal(accessToken, id)).children.summary.total).toBe(1);

    await TestRequest.patch(`/api/admin/employees/${id}`, { children: [] }, accessToken);
    expect((await reveal(accessToken, id)).children.summary.total).toBe(0);
  });

  it("refuses a change of marital status or birth date that would make the children impossible", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const { body } = await create(accessToken, { children: [{ birth_date: yearsAgo(15) }] });
    const id = body.data.id as string;

    const single = await TestRequest.patch(`/api/admin/employees/${id}`, { marital_status: MaritalStatus.SINGLE }, accessToken);
    expect(single.status).toBe(400);

    // 25 years old now, so a child of 15 is only 10 years younger.
    const younger = await TestRequest.patch(
      `/api/admin/employees/${id}`,
      { birth_date: `${yearsAgo(25)}T00:00:00.000Z` },
      accessToken,
    );
    expect(younger.status).toBe(400);
    expect((await reveal(accessToken, id)).children.summary.total).toBe(1);
  });

  it("does not tell someone without PII access what the children are when their change is refused", async () => {
    const admin = await AdminUserTest.createSuperAdmin(master.unit.id);
    const birth = yearsAgo(15);
    const { body } = await create(admin.accessToken, { children: [{ birth_date: birth }] });

    await AdminUserTest.delete();
    const plain = await AdminUserTest.createDatabaseAdmin(master.unit.id);
    const response = await TestRequest.patch(
      `/api/admin/employees/${body.data.id}`,
      { marital_status: MaritalStatus.SINGLE },
      plain.accessToken,
    );
    const text = JSON.stringify(await response.json());
    expect(response.status).toBe(400);
    expect(text).not.toContain(birth);
    expect(text).not.toContain("biological");
  });

  it("writes only the counts of the children to the audit log", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const birth = yearsAgo(7);
    const { body } = await create(accessToken, { children: [{ birth_date: birth }] });
    const entry = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.CREATE_EMPLOYEE, entity_id: body.data.id },
    });
    const text = JSON.stringify(entry.new_values);
    expect(text).toContain('"children":"1 child"');
    expect(text).not.toContain(birth);
  });

  it("releases the children when the employee is archived and keeps only the counts in the audit log", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    const birth = yearsAgo(7);
    const { body } = await create(accessToken, { children: [{ birth_date: birth }, { birth_date: yearsAgo(9) }] });
    const id = body.data.id as string;

    const removed = await TestRequest.patch(`/api/admin/employees/delete/${id}`, {}, accessToken);
    expect(removed.status).toBe(200);
    expect(await prismaClient.employeeChild.count({ where: { employee_id: id } })).toBe(0);

    const entry = await prismaClient.auditLog.findFirstOrThrow({ where: { action: AuditAction.DELETE_EMPLOYEE, entity_id: id } });
    expect(JSON.stringify(entry.old_values)).toContain('"children":"2 children"');
    expect(JSON.stringify(entry.old_values)).not.toContain(birth);
  });

  it("adds the counts to the sensitive export only", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
    await create(accessToken, { full_name: "Test Emp Export Kids", children: [{ birth_date: yearsAgo(5) }, { birth_date: yearsAgo(6) }] });

    const sensitive = await TestRequest.get("/api/admin/employees/export?format=csv&search=Export Kids&export_mode=sensitive", accessToken);
    const sensitiveCsv = await sensitive.text();
    expect(sensitiveCsv).toContain("Children Under 23");

    const basic = await TestRequest.get("/api/admin/employees/export?format=csv&search=Export Kids", accessToken);
    expect(await basic.text()).not.toContain("Children Under 23");
  });

  describe("typed counts", () => {
    const counts = (under_23: number, age_23_plus: number, adopted = 0) => ({ under_23, age_23_plus, adopted });

    it("records the numbers without any birth dates and works them into the reveal", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { response, body } = await create(accessToken, { children_counts: counts(2, 1, 1) });
      expect(response.status).toBe(200);
      const revealed = await reveal(accessToken, body.data.id);
      expect(revealed.children.mode).toBe("COUNTS");
      expect(revealed.children.summary).toEqual({ total: 3, under_23: 2, age_23_plus: 1, allowance_eligible: 2 });
      expect(revealed.children.items).toEqual([]);
      expect(revealed.children.needs_review).toBe(false);
      expect(await prismaClient.employeeChild.count({ where: { employee_id: body.data.id } })).toBe(0);
    });

    it("refuses birth dates and numbers together", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { response } = await create(accessToken, {
        children: [{ birth_date: yearsAgo(5) }],
        children_counts: counts(1, 0),
      });
      expect(response.status).toBe(400);
    });

    it("applies the numbers rules: single is adopted only, and old biological children need an old parent", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const single = await create(accessToken, { marital_status: MaritalStatus.SINGLE, children_counts: counts(1, 0, 0) });
      expect(single.response.status).toBe(400);
      const adopted = await create(accessToken, { marital_status: MaritalStatus.SINGLE, children_counts: counts(1, 0, 1) });
      expect(adopted.response.status).toBe(200);
      // 40 years old in the default body, so a child of 23 or more is not possible.
      const tooOld = await create(accessToken, { children_counts: counts(0, 1, 0) });
      expect(tooOld.response.status).toBe(400);
    });

    it("replaces the rows with numbers and the numbers with rows", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { body } = await create(accessToken, { children: [{ birth_date: yearsAgo(5) }] });
      const id = body.data.id as string;

      const toCounts = await TestRequest.patch(`/api/admin/employees/${id}`, { children_counts: counts(2, 0) }, accessToken);
      expect(toCounts.status).toBe(200);
      expect(await prismaClient.employeeChild.count({ where: { employee_id: id } })).toBe(0);
      expect((await reveal(accessToken, id)).children.mode).toBe("COUNTS");

      const toRows = await TestRequest.patch(`/api/admin/employees/${id}`, { children: [{ birth_date: yearsAgo(3) }] }, accessToken);
      expect(toRows.status).toBe(200);
      const back = (await reveal(accessToken, id)).children;
      expect(back.mode).toBe("BIRTH_DATES");
      expect(back.counts).toBeNull();

      await TestRequest.patch(`/api/admin/employees/${id}`, { children_counts: counts(1, 0) }, accessToken);
      await TestRequest.patch(`/api/admin/employees/${id}`, { children_counts: null }, accessToken);
      expect((await reveal(accessToken, id)).children.mode).toBe("NONE");
    });

    it("keeps the numbers when children are not sent, and asks for a review after a year", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { body } = await create(accessToken, { children_counts: counts(1, 0) });
      const id = body.data.id as string;
      await TestRequest.patch(`/api/admin/employees/${id}`, { notes: "unrelated" }, accessToken);
      expect((await reveal(accessToken, id)).children.mode).toBe("COUNTS");

      const old = new Date();
      old.setUTCFullYear(old.getUTCFullYear() - 2);
      await prismaClient.employee.update({ where: { id }, data: { children_declared_at: old } });
      expect((await reveal(accessToken, id)).children.needs_review).toBe(true);

      await TestRequest.patch(`/api/admin/employees/${id}`, { children_counts: counts(1, 0) }, accessToken);
      expect((await reveal(accessToken, id)).children.needs_review).toBe(false);
    });

    it("refuses a marital status change that no longer fits the numbers", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { body } = await create(accessToken, { children_counts: counts(1, 0) });
      const single = await TestRequest.patch(
        `/api/admin/employees/${body.data.id}`,
        { marital_status: MaritalStatus.SINGLE },
        accessToken,
      );
      expect(single.status).toBe(400);
    });

    it("writes only the counts to the audit log, and needs PII access to write them", async () => {
      const blocked = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      expect((await create(blocked.accessToken, { children_counts: counts(1, 0) })).response.status).toBe(403);

      await AdminUserTest.delete();
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { body } = await create(accessToken, { children_counts: counts(2, 0) });
      const entry = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.CREATE_EMPLOYEE, entity_id: body.data.id },
      });
      expect(JSON.stringify(entry.new_values)).toContain('"children":"2 children"');
    });

    it("releases the numbers when the employee is archived and shows them in the export", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { body } = await create(accessToken, { full_name: "Test Emp Export Counts", children_counts: counts(2, 0) });
      const sensitive = await TestRequest.get("/api/admin/employees/export?format=csv&search=Export Counts&export_mode=sensitive", accessToken);
      expect(await sensitive.text()).toContain("Children Under 23");

      const id = body.data.id as string;
      expect((await TestRequest.patch(`/api/admin/employees/delete/${id}`, {}, accessToken)).status).toBe(200);
      const row = await prismaClient.employee.findUniqueOrThrow({ where: { id } });
      expect(row.children_declared_under_23).toBeNull();
      expect(row.children_declared_at).toBeNull();
    });
  });

  describe("allowance rule", () => {
    const rulePath = "/api/admin/employee-settings/children-allowance";
    const valid = { max_children: 2, age_limit: 21, count_biological: true, count_adopted: true, count_step: false };

    afterEach(async () => {
      await prismaClient.childrenAllowanceRule.deleteMany();
    });

    it("starts with the default rule and shows it to any admin", async () => {
      const viewer = await AdminUserTest.createViewer(master.unit.id);
      const response = await TestRequest.get(rulePath, viewer.accessToken);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({ max_children: 3, age_limit: 23, count_biological: true, count_adopted: true, count_step: true });
    });

    it("is changed by a Super Admin only, and the change is audited", async () => {
      const plain = await AdminUserTest.createDatabaseAdmin(master.unit.id);
      expect((await TestRequest.put(rulePath, valid, plain.accessToken)).status).toBe(403);

      await AdminUserTest.delete();
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const response = await TestRequest.put(rulePath, valid, accessToken);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual(valid);
      expect((await (await TestRequest.get(rulePath, accessToken)).json()).data).toEqual(valid);

      const entry = await prismaClient.auditLog.findFirstOrThrow({
        where: { action: AuditAction.UPDATE_MASTER_DATA, entity_type: "ChildrenAllowanceRule" },
      });
      expect(entry.old_values).toMatchObject({ max_children: 3 });
      expect(entry.new_values).toMatchObject({ max_children: 2, count_step: false });
    });

    it("refuses a rule that makes no sense", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      for (const bad of [
        { ...valid, max_children: 0 },
        { ...valid, max_children: 21 },
        { ...valid, age_limit: 0 },
        { ...valid, count_biological: false, count_adopted: false, count_step: false },
      ]) {
        expect((await TestRequest.put(rulePath, bad, accessToken)).status).toBe(400);
      }
      expect((await TestRequest.put(rulePath, { ...valid, max_children: null }, accessToken)).status).toBe(200);
    });

    it("decides how many children the employee gets the allowance for", async () => {
      const { accessToken } = await AdminUserTest.createSuperAdmin(master.unit.id);
      const { body } = await create(accessToken, {
        children: [
          { birth_date: yearsAgo(3) },
          { birth_date: yearsAgo(5) },
          { birth_date: yearsAgo(7), relation: ChildRelation.STEP },
          { birth_date: yearsAgo(9) },
        ],
      });
      const id = body.data.id as string;
      expect((await reveal(accessToken, id)).children.summary).toMatchObject({ total: 4, allowance_eligible: 3 });

      await TestRequest.put(rulePath, valid, accessToken);
      expect((await reveal(accessToken, id)).children.summary).toMatchObject({ total: 4, allowance_eligible: 2 });

      await TestRequest.put(rulePath, { ...valid, max_children: null, count_step: true }, accessToken);
      expect((await reveal(accessToken, id)).children.summary).toMatchObject({ total: 4, allowance_eligible: 4 });
    });
  });
});
