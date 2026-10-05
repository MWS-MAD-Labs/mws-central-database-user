import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { prismaClient } from "../lib/prisma";
import {
  AdminUserTest,
  AuditLogTest,
  DisciplinaryActionAttachmentTest,
  EmployeeTest,
  MasterDataTest,
  TestRequest,
} from "./test-utils";

const BASE = "/api/admin/identifier-change-requests";

describe("Disciplinary letter change requests", () => {
  async function cleanup() {
    await prismaClient.identifierChangeRequest.deleteMany({
      where: { requester: { email: { contains: "@millennia21.id" } } },
    });
    await AuditLogTest.delete();
    await DisciplinaryActionAttachmentTest.delete();
    await prismaClient.employeeDisciplinaryAction.deleteMany({
      where: { reason: { startsWith: "TEST_" } },
    });
    await EmployeeTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  }
  beforeEach(cleanup);
  afterEach(cleanup);

  async function setup(options: { withApprover?: boolean } = {}) {
    const withApprover = options.withApprover ?? true;
    const { unit, position, level, building } = await MasterDataTest.create();
    const person = await EmployeeTest.create({
      email: "test_dcr_employee@millennia21.id",
      unitId: unit.id,
      jobPositionId: position.id,
      jobLevelId: level.id,
      buildingId: building.id,
    });
    const employeeId = person.employee!.id;
    const action = await prismaClient.employeeDisciplinaryAction.create({
      data: {
        employee_id: employeeId,
        type: "SURAT_TEGURAN",
        level: 1,
        issued_date: new Date(),
        valid_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        reason: "TEST_original reason",
        notes: "original notes",
      },
    });
    const requester = await AdminUserTest.createDatabaseAdmin(unit.id, {
      id: "test-dcr-requester-id",
      email: "test_dcr_requester@millennia21.id",
      canViewEmployeeDisciplinaryData: true,
      canWriteEmployeeData: true,
      canViewEmployeeData: true,
    });
    const approver = await AdminUserTest.createDatabaseAdmin(unit.id, {
      id: "test-dcr-approver-id",
      email: "test_dcr_approver@millennia21.id",
      canViewEmployeeDisciplinaryData: true,
      canWriteEmployeeData: true,
      canViewEmployeeData: true,
    });
    if (withApprover) {
      const headOfCare = await prismaClient.masterJobPosition.upsert({
        where: { name: "Head of CARE" },
        update: {},
        create: { name: "Head of CARE" },
      });
      const approverPerson = await EmployeeTest.create({
        email: "test_dcr_approver@millennia21.id",
        unitId: unit.id,
        jobPositionId: headOfCare.id,
        jobLevelId: level.id,
        buildingId: building.id,
      });
      await prismaClient.adminUser.update({
        where: { id: "test-dcr-approver-id" },
        data: { can_approve_identifier_changes: true, person_id: approverPerson.id },
      });
    }
    return { employeeId, action, requester, approver };
  }

  const actionUrl = (employeeId: string, actionId: string) =>
    `/api/admin/employees/${employeeId}/disciplinary-actions/${actionId}`;

  it("refuses a direct edit from someone who is not an approver", async () => {
    const { employeeId, action, requester } = await setup();
    const response = await TestRequest.patch(
      actionUrl(employeeId, action.id),
      { reason: "TEST_sneaky edit" },
      requester.accessToken,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).errors).toContain("needs approval");
  });

  it("files one request per changed field, then applies them on approval", async () => {
    const { employeeId, action, requester, approver } = await setup();
    const filed = await TestRequest.post(
      `${actionUrl(employeeId, action.id)}/change-requests`,
      { reason: "TEST_new reason", notes: "new notes", change_reason: "Wrong details" },
      requester.accessToken,
    );
    expect(filed.status).toBe(200);
    const { request_ids } = (await filed.json()).data;
    expect(request_ids).toHaveLength(2);

    // Nothing changes until it is approved.
    const untouched = await prismaClient.employeeDisciplinaryAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(untouched.reason).toBe("TEST_original reason");

    const queue = await (await TestRequest.get(`${BASE}?entity_type=DisciplinaryAction`, approver.accessToken)).json();
    expect(queue.data).toHaveLength(2);
    expect(queue.data[0].can_decide).toBe(true);

    for (const id of request_ids) {
      const approved = await TestRequest.patch(`${BASE}/${id}/approve`, {}, approver.accessToken);
      expect(approved.status).toBe(200);
    }
    const changed = await prismaClient.employeeDisciplinaryAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(changed.reason).toBe("TEST_new reason");
    expect(changed.notes).toBe("new notes");
  });

  it("leaves the letter alone on reject and refuses a stale approval", async () => {
    const { employeeId, action, requester, approver } = await setup();
    const filed = await (await TestRequest.post(
      `${actionUrl(employeeId, action.id)}/change-requests`,
      { reason: "TEST_rejected reason", change_reason: "Please fix" },
      requester.accessToken,
    )).json();
    const [id] = filed.data.request_ids;

    const rejected = await TestRequest.patch(`${BASE}/${id}/reject`, { decision_note: "Not needed" }, approver.accessToken);
    expect(rejected.status).toBe(200);
    expect((await prismaClient.employeeDisciplinaryAction.findUniqueOrThrow({ where: { id: action.id } })).reason).toBe("TEST_original reason");

    const second = await (await TestRequest.post(
      `${actionUrl(employeeId, action.id)}/change-requests`,
      { reason: "TEST_stale reason", change_reason: "Please fix" },
      requester.accessToken,
    )).json();
    await prismaClient.employeeDisciplinaryAction.update({ where: { id: action.id }, data: { reason: "TEST_moved on" } });
    const stale = await TestRequest.patch(`${BASE}/${second.data.request_ids[0]}/approve`, {}, approver.accessToken);
    expect(stale.status).toBe(409);
  });

  it("lets an approver edit directly and blocks them from filing a request", async () => {
    const { employeeId, action, approver } = await setup();
    const direct = await TestRequest.patch(
      actionUrl(employeeId, action.id),
      { reason: "TEST_approver edit" },
      approver.accessToken,
    );
    expect(direct.status).toBe(200);

    const filed = await TestRequest.post(
      `${actionUrl(employeeId, action.id)}/change-requests`,
      { reason: "TEST_other", change_reason: "Why not" },
      approver.accessToken,
    );
    expect(filed.status).toBe(400);
  });

  it("refuses to file when nobody can approve", async () => {
    const { employeeId, action, requester } = await setup({ withApprover: false });
    const filed = await TestRequest.post(
      `${actionUrl(employeeId, action.id)}/change-requests`,
      { reason: "TEST_x", change_reason: "Please fix" },
      requester.accessToken,
    );
    expect(filed.status).toBe(400);
    expect((await filed.json()).errors).toContain("No approver");
  });

  it("removes and restores an attachment only after approval", async () => {
    const { employeeId, action, requester, approver } = await setup();
    const attachment = await prismaClient.disciplinaryActionAttachment.create({
      data: {
        disciplinary_action_id: action.id,
        file_name: "letter.pdf",
        object_key: `test-dcr/${action.id}/letter.pdf`,
        file_size: 10,
        mime_type: "application/pdf",
        uploaded_by: "test-dcr-requester-id",
      },
    });
    const base = `${actionUrl(employeeId, action.id)}/attachments`;

    const direct = await TestRequest.patch(`${base}/delete/${attachment.id}`, {}, requester.accessToken);
    expect(direct.status).toBe(403);

    const filed = await TestRequest.post(
      `${base}/${attachment.id}/change-requests`,
      { kind: "remove", change_reason: "Wrong file" },
      requester.accessToken,
    );
    expect(filed.status).toBe(200);
    expect((await prismaClient.disciplinaryActionAttachment.findUniqueOrThrow({ where: { id: attachment.id } })).deleted_at).toBeNull();

    await TestRequest.patch(`${BASE}/${(await filed.json()).data.request_ids[0]}/approve`, {}, approver.accessToken);
    expect((await prismaClient.disciplinaryActionAttachment.findUniqueOrThrow({ where: { id: attachment.id } })).deleted_at).not.toBeNull();

    const restore = await TestRequest.post(
      `${base}/${attachment.id}/change-requests`,
      { kind: "restore", change_reason: "Needed after all" },
      requester.accessToken,
    );
    await TestRequest.patch(`${BASE}/${(await restore.json()).data.request_ids[0]}/approve`, {}, approver.accessToken);
    expect((await prismaClient.disciplinaryActionAttachment.findUniqueOrThrow({ where: { id: attachment.id } })).deleted_at).toBeNull();
  });

  it("keeps a staged upload hidden until approved and drops it on reject", async () => {
    const { employeeId, action, requester, approver } = await setup();
    const staged = await prismaClient.disciplinaryActionAttachment.create({
      data: {
        disciplinary_action_id: action.id,
        file_name: "staged.pdf",
        object_key: `test-dcr/${action.id}/staged.pdf`,
        file_size: 10,
        mime_type: "application/pdf",
        uploaded_by: "test-dcr-requester-id",
        pending_approval: true,
      },
    });
    const approved = await prismaClient.identifierChangeRequest.create({
      data: {
        entity_type: "DisciplinaryAction",
        entity_id: action.id,
        field_name: "attachment_add",
        old_value: "staged.pdf",
        new_value: staged.id,
        reason: "Signed copy",
        requested_by: "test-dcr-requester-id",
      },
    });
    const list = `${actionUrl(employeeId, action.id)}/attachments`;
    const hidden = await (await TestRequest.get(list, approver.accessToken)).json();
    expect(hidden.data).toHaveLength(0);

    const ok = await TestRequest.patch(`${BASE}/${approved.id}/approve`, {}, approver.accessToken);
    expect(ok.status).toBe(200);
    const visible = await (await TestRequest.get(list, approver.accessToken)).json();
    expect(visible.data).toHaveLength(1);

    const second = await prismaClient.disciplinaryActionAttachment.create({
      data: {
        disciplinary_action_id: action.id,
        file_name: "rejected.pdf",
        object_key: `test-dcr/${action.id}/rejected.pdf`,
        file_size: 10,
        mime_type: "application/pdf",
        uploaded_by: "test-dcr-requester-id",
        pending_approval: true,
      },
    });
    const secondReq = await prismaClient.identifierChangeRequest.create({
      data: {
        entity_type: "DisciplinaryAction",
        entity_id: action.id,
        field_name: "attachment_add",
        old_value: "rejected.pdf",
        new_value: second.id,
        reason: "Another copy",
        requested_by: "test-dcr-requester-id",
      },
    });
    await TestRequest.patch(`${BASE}/${secondReq.id}/reject`, { decision_note: "No" }, approver.accessToken);
    expect(await prismaClient.disciplinaryActionAttachment.findUnique({ where: { id: second.id } })).toBeNull();
    void requester;
  });
});
