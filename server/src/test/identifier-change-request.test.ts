import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { prismaClient } from "../lib/prisma";
import {
  AdminUserTest,
  AuditLogTest,
  EmployeeTest,
  MasterDataTest,
  TestRequest,
} from "./test-utils";

const BASE = "/api/admin/identifier-change-requests";
const APPROVER_EMAIL = "test_icr_approver@millennia21.id";
const VIEWER_ALLOWLISTED_EMAIL = "test_icr_viewer_allowlisted@millennia21.id";
const OTHER_PROTECTED_EMAIL = "test_icr_protected_but_not_approver@millennia21.id";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function randomNik(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join("");
}

describe("Identifier change requests", () => {
  const originalApprovers = process.env.IDENTIFIER_CHANGE_APPROVER_EMAILS;
  const originalProtected = process.env.PROTECTED_SUPER_ADMIN_EMAILS;

  beforeAll(() => {
    // Deliberately different email than PROTECTED_SUPER_ADMIN_EMAILS, to
    // prove the two allowlists are fully decoupled per item 9.
    process.env.IDENTIFIER_CHANGE_APPROVER_EMAILS = `${APPROVER_EMAIL},${VIEWER_ALLOWLISTED_EMAIL}`;
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = OTHER_PROTECTED_EMAIL;
  });
  afterAll(() => {
    if (originalApprovers === undefined) delete process.env.IDENTIFIER_CHANGE_APPROVER_EMAILS;
    else process.env.IDENTIFIER_CHANGE_APPROVER_EMAILS = originalApprovers;
    if (originalProtected === undefined) delete process.env.PROTECTED_SUPER_ADMIN_EMAILS;
    else process.env.PROTECTED_SUPER_ADMIN_EMAILS = originalProtected;
  });

  async function cleanup() {
    await prismaClient.identifierChangeRequest.deleteMany({
      where: { requester: { email: { contains: "@millennia21.id" } } },
    });
    await AuditLogTest.delete();
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  async function setup(options: { locked?: boolean } = { locked: true }) {
    const { unit, position, level, building } = await MasterDataTest.create();
    const person = await EmployeeTest.create({
      email: "test_icr_employee@millennia21.id",
      unitId: unit.id,
      jobPositionId: position.id,
      jobLevelId: level.id,
      buildingId: building.id,
    });
    const nik = randomNik();
    const setAt = options.locked ? new Date(Date.now() - TWO_DAYS_MS) : new Date();
    const employee = await prismaClient.employee.update({
      where: { id: person.employee!.id },
      data: { nik, nik_set_at: setAt, created_at: setAt },
    });
    // Requester: a normal DB Admin, not on the approver allowlist.
    const requester = await AdminUserTest.createDatabaseAdmin(unit.id, {
      canViewEmployeePii: true,
      id: "test-icr-requester-id",
      email: "test_icr_requester@millennia21.id",
    });
    // Approver: DB Admin (the role floor) whose email IS on the allowlist.
    const approver = await AdminUserTest.createDatabaseAdmin(unit.id, {
      canViewEmployeePii: true,
      id: "test-icr-approver-id",
      email: APPROVER_EMAIL,
    });
    return {
      employee,
      nik,
      setAt,
      requester,
      approver,
      approverId: "test-icr-approver-id",
      unitId: unit.id,
    };
  }

  async function submit(employeeId: string, token: string, newValue = randomNik()) {
    const response = await TestRequest.post(
      BASE,
      {
        entity_type: "Employee",
        entity_id: employeeId,
        field_name: "nik",
        new_value: newValue,
        reason: "Typo in the original NIK",
      },
      token,
    );
    return { response, body: await response.json(), newValue };
  }

  it("rejects a request for a field that isn't locked yet", async () => {
    const { employee, requester } = await setup({ locked: false });
    const { response, body } = await submit(employee.id, requester.accessToken);
    expect(response.status).toBe(400);
    expect(body.errors).toContain("isn't locked yet");
  });

  it("creates a pending request and blocks a second pending one for the same field", async () => {
    const { employee, nik, requester } = await setup();
    const first = await submit(employee.id, requester.accessToken);
    expect(first.response.status).toBe(200);
    expect(first.body.data.status).toBe("PENDING");
    expect(first.body.data.old_value).toBe(nik);

    const second = await submit(employee.id, requester.accessToken);
    expect(second.response.status).toBe(400);
    expect(second.body.errors).toContain("already a pending");
  });

  it("blocks approval by a non-approver", async () => {
    const { employee, requester } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);

    const byNonApprover = await TestRequest.patch(
      `${BASE}/${body.data.id}/approve`,
      {},
      requester.accessToken,
    );
    expect(byNonApprover.status).toBe(403);
  });

  it("blocks an approver from deciding a request filed under their own account", async () => {
    // Approvers can no longer file a request via the API (create() rejects
    // them), so exercise the self-approval guard directly at the DB layer.
    const { employee, nik, approver, approverId } = await setup();
    const created = await prismaClient.identifierChangeRequest.create({
      data: {
        entity_type: "Employee",
        entity_id: employee.id,
        field_name: "nik",
        old_value: nik,
        new_value: randomNik(),
        reason: "Simulated self-filed request",
        requested_by: approverId,
      },
    });

    const bySelf = await TestRequest.patch(`${BASE}/${created.id}/approve`, {}, approver.accessToken);
    expect(bySelf.status).toBe(403);
  });

  it("a protected Super Admin who isn't on the approver allowlist still can't approve", async () => {
    const { employee, requester } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);

    const protectedButNotApprover = await AdminUserTest.createSuperAdmin(undefined, {
      id: "test-icr-protected-id",
      email: OTHER_PROTECTED_EMAIL,
    });
    const response = await TestRequest.patch(
      `${BASE}/${body.data.id}/approve`,
      {},
      protectedButNotApprover.accessToken,
    );
    expect(response.status).toBe(403);
  });

  it("an allowlisted email still can't approve below the DATABASE_ADMIN role floor", async () => {
    const { employee, requester } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);

    const allowlistedViewer = await AdminUserTest.createViewer(undefined, {
      id: "test-icr-viewer-approver-id",
      email: VIEWER_ALLOWLISTED_EMAIL,
    });
    const response = await TestRequest.patch(
      `${BASE}/${body.data.id}/approve`,
      {},
      allowlistedViewer.accessToken,
    );
    expect(response.status).toBe(403);
  });

  it("approve applies the new value and keeps the field locked", async () => {
    const { employee, setAt, requester, approver } = await setup();
    const { body, newValue } = await submit(employee.id, requester.accessToken);

    const response = await TestRequest.patch(
      `${BASE}/${body.data.id}/approve`,
      { decision_note: "Checked against KTP" },
      approver.accessToken,
    );
    const approved = await response.json();
    expect(response.status).toBe(200);
    expect(approved.data.status).toBe("APPROVED");

    const updated = await prismaClient.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(updated.nik).toBe(newValue);
    expect(updated.nik_set_at?.getTime()).toBe(setAt.getTime());
  });

  it("approve fails with 409 when the value changed after the request, and the request stays pending", async () => {
    const { employee, requester, approver } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);
    await prismaClient.employee.update({ where: { id: employee.id }, data: { nik: randomNik() } });

    const response = await TestRequest.patch(`${BASE}/${body.data.id}/approve`, {}, approver.accessToken);
    expect(response.status).toBe(409);

    const record = await prismaClient.identifierChangeRequest.findUniqueOrThrow({
      where: { id: body.data.id },
    });
    expect(record.status).toBe("PENDING");
    expect(record.decided_by).toBeNull();
  });

  it("reject requires a note", async () => {
    const { employee, requester, approver } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);

    const noNote = await TestRequest.patch(`${BASE}/${body.data.id}/reject`, {}, approver.accessToken);
    expect(noNote.status).toBe(400);

    const withNote = await TestRequest.patch(
      `${BASE}/${body.data.id}/reject`,
      { decision_note: "Value doesn't match the KTP scan" },
      approver.accessToken,
    );
    expect(withNote.status).toBe(200);
    expect((await withNote.json()).data.status).toBe("REJECTED");
  });

  it("only the requester can cancel", async () => {
    const { employee, requester, approver } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);

    const byOther = await TestRequest.patch(`${BASE}/${body.data.id}/cancel`, {}, approver.accessToken);
    expect(byOther.status).toBe(403);

    const bySelf = await TestRequest.patch(`${BASE}/${body.data.id}/cancel`, {}, requester.accessToken);
    expect(bySelf.status).toBe(200);
    expect((await bySelf.json()).data.status).toBe("CANCELLED");
  });

  it("lists everything for approvers but only own requests for everyone else", async () => {
    const { employee, requester, approver } = await setup();
    await submit(employee.id, requester.accessToken);

    const asApprover = await (await TestRequest.get(BASE, approver.accessToken)).json();
    expect(asApprover.can_approve).toBe(true);
    expect(asApprover.data).toHaveLength(1);
    expect(asApprover.data[0].can_decide).toBe(true);

    const asRequester = await (await TestRequest.get(BASE, requester.accessToken)).json();
    expect(asRequester.can_approve).toBe(false);
    expect(asRequester.data[0].can_cancel).toBe(true);
  });

  it("an approver can edit a locked field directly, with no request needed, and the field stays locked for others", async () => {
    const { employee, setAt, approver } = await setup();
    const newNik = randomNik();

    const response = await TestRequest.patch(
      `/api/admin/employees/${employee.id}`,
      { nik: newNik },
      approver.accessToken,
    );
    expect(response.status).toBe(200);

    const updated = await prismaClient.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(updated.nik).toBe(newNik);
    expect(updated.nik_set_at?.getTime()).toBe(setAt.getTime());
  });

  it("an approver is rejected trying to file a request, since they can edit the field directly", async () => {
    const { employee, approver } = await setup();
    const { response, body } = await submit(employee.id, approver.accessToken);
    expect(response.status).toBe(400);
    expect(body.errors).toContain("no request needed");
  });
});
