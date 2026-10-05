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
  const originalProtected = process.env.PROTECTED_SUPER_ADMIN_EMAILS;

  beforeAll(() => {
    // Approvers are DB flags now; the protected list only gates who can pick them.
    process.env.PROTECTED_SUPER_ADMIN_EMAILS = OTHER_PROTECTED_EMAIL;
  });
  afterAll(() => {
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
    // Approver: DB Admin (the role floor) with the approver flag, linked to
    // an active Head of CARE employee.
    const approver = await AdminUserTest.createDatabaseAdmin(unit.id, {
      canViewEmployeePii: true,
      id: "test-icr-approver-id",
      email: APPROVER_EMAIL,
    });
    const headOfCare = await prismaClient.masterJobPosition.upsert({
      where: { name: "Head of CARE" },
      update: {},
      create: { name: "Head of CARE" },
    });
    const approverPerson = await EmployeeTest.create({
      email: APPROVER_EMAIL,
      unitId: unit.id,
      jobPositionId: headOfCare.id,
      jobLevelId: level.id,
      buildingId: building.id,
    });
    await prismaClient.adminUser.update({
      where: { id: "test-icr-approver-id" },
      data: {
        can_approve_identifier_changes: true,
        person_id: approverPerson.id,
      },
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

  it("does not open a new grace window after an approved change or an approver edit", async () => {
    const { employee, requester, approver } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);
    const approved = await TestRequest.patch(`${BASE}/${body.data.id}/approve`, {}, approver.accessToken);
    expect(approved.status).toBe(200);

    // Still locked for a normal admin right after the approved change.
    const afterApproval = await TestRequest.patch(
      `/api/admin/employees/${employee.id}`,
      { nik: randomNik() },
      requester.accessToken,
    );
    expect(afterApproval.status).toBe(400);

    // The approver edits directly, and that does not unlock it either.
    const direct = await TestRequest.patch(
      `/api/admin/employees/${employee.id}`,
      { nik: randomNik() },
      approver.accessToken,
    );
    expect(direct.status).toBe(200);
    const afterDirect = await TestRequest.patch(
      `/api/admin/employees/${employee.id}`,
      { nik: randomNik() },
      requester.accessToken,
    );
    expect(afterDirect.status).toBe(400);
  });

  it("lets the requester see decisions and notes, counts unseen ones, and clears them when opened", async () => {
    const { employee, requester, approver } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);

    const pending = await (await TestRequest.get(`${BASE}/mine`, requester.accessToken)).json();
    expect(pending.data).toHaveLength(1);
    expect(pending.data[0].status).toBe("PENDING");
    expect(pending.unseen_decided_count).toBe(0);

    await TestRequest.patch(`${BASE}/${body.data.id}/reject`, { decision_note: "Please attach the KTP" }, approver.accessToken);

    const decided = await (await TestRequest.get(`${BASE}/mine`, requester.accessToken)).json();
    expect(decided.data[0].status).toBe("REJECTED");
    expect(decided.data[0].decision_note).toBe("Please attach the KTP");
    expect(decided.data[0].decided_by.full_name).toBeTruthy();
    expect(decided.unseen_decided_count).toBe(1);

    const seen = await TestRequest.post(`${BASE}/mine/seen`, {}, requester.accessToken);
    expect(seen.status).toBe(200);
    expect((await seen.json()).data).toBe(1);
    const after = await (await TestRequest.get(`${BASE}/mine`, requester.accessToken)).json();
    expect(after.unseen_decided_count).toBe(0);

    // Someone else's list never shows it, and filters by record work.
    const others = await (await TestRequest.get(`${BASE}/mine`, approver.accessToken)).json();
    expect(others.data).toHaveLength(0);
    const filtered = await (
      await TestRequest.get(`${BASE}/mine?entity_type=Employee&entity_id=${employee.id}`, requester.accessToken)
    ).json();
    expect(filtered.data).toHaveLength(1);

    const viewer = await AdminUserTest.createViewer(undefined, {
      id: "test-icr-mine-viewer",
      email: "test_icr_mine_viewer@millennia21.id",
    });
    expect((await TestRequest.get(`${BASE}/mine`, viewer.accessToken)).status).toBe(403);
  });

  it("caps the reason and decision notes at 100 characters", async () => {
    const { employee, requester, approver } = await setup();
    const tooLong = "x".repeat(101);

    const longReason = await TestRequest.post(BASE, {
      entity_type: "Employee",
      entity_id: employee.id,
      field_name: "nik",
      new_value: randomNik(),
      reason: tooLong,
    }, requester.accessToken);
    expect(longReason.status).toBe(400);
    expect(JSON.stringify(await longReason.json())).toContain("at most 100");

    const { body } = await submit(employee.id, requester.accessToken);
    const longReject = await TestRequest.patch(`${BASE}/${body.data.id}/reject`, { decision_note: tooLong }, approver.accessToken);
    expect(longReject.status).toBe(400);
    const longApprove = await TestRequest.patch(`${BASE}/${body.data.id}/approve`, { decision_note: tooLong }, approver.accessToken);
    expect(longApprove.status).toBe(400);

    const okNote = await TestRequest.patch(`${BASE}/${body.data.id}/reject`, { decision_note: "x".repeat(100) }, approver.accessToken);
    expect(okNote.status).toBe(200);
  });

  it("pages the list, splits History from Pending, and counts what the admin can decide", async () => {
    const { employee, requester, approver } = await setup();
    // Three requests on three fields, so each is allowed alongside the others.
    const fields = ["nik", "npwp", "bank_account_number"];
    await prismaClient.employee.update({
      where: { id: employee.id },
      data: {
        npwp: "111111111123000",
        npwp_set_at: new Date(Date.now() - TWO_DAYS_MS),
        bank_account_number: "1234567890",
        bank_account_number_set_at: new Date(Date.now() - TWO_DAYS_MS),
      },
    });
    const created: string[] = [];
    for (const field of fields) {
      const response = await TestRequest.post(BASE, {
        entity_type: "Employee",
        entity_id: employee.id,
        field_name: field,
        new_value: field === "nik" ? randomNik() : field === "npwp" ? "222222222223000" : "9876543210",
        reason: "Fixing a typo",
      }, requester.accessToken);
      expect(response.status).toBe(200);
      created.push((await response.json()).data.id);
    }

    const first = await (await TestRequest.get(`${BASE}?status=PENDING&page=1&size=2`, approver.accessToken)).json();
    expect(first.data).toHaveLength(2);
    expect(first.paging.total_item).toBe(3);
    expect(first.paging.total_page).toBe(2);
    expect(first.pending_decidable_count).toBe(3);
    const second = await (await TestRequest.get(`${BASE}?status=PENDING&page=2&size=2`, approver.accessToken)).json();
    expect(second.data).toHaveLength(1);

    await TestRequest.patch(`${BASE}/${created[0]}/reject`, { decision_note: "Not needed" }, approver.accessToken);
    const history = await (await TestRequest.get(`${BASE}?history=true`, approver.accessToken)).json();
    expect(history.paging.total_item).toBe(1);
    expect(history.data[0].status).toBe("REJECTED");
    expect(history.pending_decidable_count).toBe(2);
  });

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

  it("an approver who is not a Head of CARE can't decide an employee request", async () => {
    const { employee, requester, approver, unitId } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);
    const position = await prismaClient.masterJobPosition.findFirstOrThrow({
      where: { name: { startsWith: "TEST_" } },
    });
    await prismaClient.employee.updateMany({
      where: { person: { email: APPROVER_EMAIL } },
      data: { job_position_id: position.id },
    });
    expect(unitId).toBeDefined();

    const response = await TestRequest.patch(
      `${BASE}/${body.data.id}/approve`,
      {},
      approver.accessToken,
    );
    expect(response.status).toBe(403);
  });

  it("reports approver availability, refuses new requests without one, and keeps old ones for later", async () => {
    const { employee, requester, approver } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);
    expect(body.data.status).toBe("PENDING");

    const withApprover = await (await TestRequest.get(`${BASE}/approver-status`, requester.accessToken)).json();
    expect(withApprover.data.employee).toBe(true);

    // The only approver loses the flag: nobody can review anymore.
    await prismaClient.adminUser.update({
      where: { id: "test-icr-approver-id" },
      data: { can_approve_identifier_changes: false },
    });
    const without = await (await TestRequest.get(`${BASE}/approver-status`, requester.accessToken)).json();
    expect(without.data.employee).toBe(false);

    await prismaClient.identifierChangeRequest.deleteMany({});
    const refused = await submit(employee.id, requester.accessToken);
    expect(refused.response.status).toBe(400);
    expect(refused.body.errors).toContain("No approver is set up yet");

    // A request filed earlier shows up as soon as an approver exists again.
    await prismaClient.identifierChangeRequest.create({
      data: {
        entity_type: "Employee",
        entity_id: employee.id,
        field_name: "nik",
        old_value: employee.nik,
        new_value: randomNik(),
        reason: "Filed before the approver was removed",
        requested_by: "test-icr-requester-id",
      },
    });
    await prismaClient.adminUser.update({
      where: { id: "test-icr-approver-id" },
      data: { can_approve_identifier_changes: true },
    });
    const queue = await (await TestRequest.get(BASE, approver.accessToken)).json();
    expect(queue.data).toHaveLength(1);
  });

  it("only a protected Super Admin can pick approvers, and only Head of CARE admins", async () => {
    const { requester } = await setup();
    const notProtected = await AdminUserTest.createSuperAdmin(undefined, {
      id: "test-icr-plain-super-id",
      email: "test_icr_plain_super@millennia21.id",
    });
    const denied = await TestRequest.patch(
      `/api/admin/admin-users/can-approve-identifier-changes/test-icr-approver-id`,
      { can_approve_identifier_changes: false },
      notProtected.accessToken,
    );
    expect(denied.status).toBe(403);
    expect(requester.accessToken).toBeDefined();

    const protectedAdmin = await AdminUserTest.createSuperAdmin(undefined, {
      id: "test-icr-protected-id",
      email: OTHER_PROTECTED_EMAIL,
    });

    // The requester is a plain DB admin (not Head of CARE): clear message, no 500.
    const notHeadOfCare = await TestRequest.patch(
      `/api/admin/admin-users/can-approve-identifier-changes/test-icr-requester-id`,
      { can_approve_identifier_changes: true },
      protectedAdmin.accessToken,
    );
    expect(notHeadOfCare.status).toBe(400);
    expect(JSON.stringify(await notHeadOfCare.json())).toContain("Head of CARE");

    // The approver fixture is linked to a Head of CARE employee: turn off, then on.
    const off = await TestRequest.patch(
      `/api/admin/admin-users/can-approve-identifier-changes/test-icr-approver-id`,
      { can_approve_identifier_changes: false },
      protectedAdmin.accessToken,
    );
    expect(off.status).toBe(200);
    const on = await TestRequest.patch(
      `/api/admin/admin-users/can-approve-identifier-changes/test-icr-approver-id`,
      { can_approve_identifier_changes: true },
      protectedAdmin.accessToken,
    );
    expect(on.status).toBe(200);
    expect((await on.json()).data.is_head_of_care).toBe(true);
  });

  it("the admin list marks Head of CARE admins", async () => {
    await setup();
    const protectedAdmin = await AdminUserTest.createSuperAdmin(undefined, {
      id: "test-icr-protected-id",
      email: OTHER_PROTECTED_EMAIL,
    });
    const response = await TestRequest.get(
      "/api/admin/admin-users?size=50",
      protectedAdmin.accessToken,
    );
    expect(response.status).toBe(200);
    const rows = (await response.json()).data as { id: string; is_head_of_care: boolean }[];
    expect(rows.find((row) => row.id === "test-icr-approver-id")?.is_head_of_care).toBe(true);
    expect(rows.find((row) => row.id === "test-icr-requester-id")?.is_head_of_care).toBe(false);
  });

  it("a protected Super Admin who isn't flagged as approver still can't approve", async () => {
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

  it("a flagged viewer still can't approve below the DATABASE_ADMIN role floor", async () => {
    const { employee, requester } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);

    const allowlistedViewer = await AdminUserTest.createViewer(undefined, {
      id: "test-icr-viewer-approver-id",
      email: VIEWER_ALLOWLISTED_EMAIL,
    });
    await prismaClient.adminUser.update({
      where: { id: "test-icr-viewer-approver-id" },
      data: { can_approve_identifier_changes: true },
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

  it("lists requests for approvers only, and answers non-approvers with 403", async () => {
    const { employee, requester, approver } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);

    const asApprover = await (await TestRequest.get(BASE, approver.accessToken)).json();
    expect(asApprover.can_approve).toBe(true);
    expect(asApprover.data).toHaveLength(1);
    expect(asApprover.data[0].can_decide).toBe(true);

    const asRequester = await TestRequest.get(BASE, requester.accessToken);
    expect(asRequester.status).toBe(403);
    const single = await TestRequest.get(`${BASE}/${body.data.id}`, requester.accessToken);
    expect(single.status).toBe(403);
  });

  it("a requester can still cancel their own request", async () => {
    const { employee, requester } = await setup();
    const { body } = await submit(employee.id, requester.accessToken);
    const cancelled = await TestRequest.patch(`${BASE}/${body.data.id}/cancel`, {}, requester.accessToken);
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).data.status).toBe("CANCELLED");
  });

  it("a flagged approver with no linked employee can list but not decide employee requests", async () => {
    const { employee, requester } = await setup();
    await submit(employee.id, requester.accessToken);
    const unlinked = await AdminUserTest.createDatabaseAdmin(undefined, {
      id: "test-icr-unlinked-approver-id",
      email: "test_icr_unlinked_approver@millennia21.id",
    });
    await prismaClient.adminUser.update({
      where: { id: "test-icr-unlinked-approver-id" },
      data: { can_approve_identifier_changes: true, person_id: null },
    });
    const response = await TestRequest.get(BASE, unlinked.accessToken);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].can_decide).toBe(false);
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
