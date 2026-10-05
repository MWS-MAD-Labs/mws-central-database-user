import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import { TestRequest, AdminUserTest, AuditLogTest, MasterDataTest, EmployeeTest } from "./test-utils";
import {
  AuditAction,
  EmploymentType,
  Gender,
  Religion,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
  type MasterBuilding,
  EmployeeStatus,
  MaritalStatus,
} from "../generated/prisma/client";
import { logger } from "../lib/logger";
import { prismaClient } from "../lib/prisma";
import { DisciplinaryActionService } from "../service/disciplinary-action-service";

describe("Employee disciplinary actions (Surat Teguran / Surat Peringatan)", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
    building: MasterBuilding;
  };

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  async function createEmployee(
    accessToken: string,
    employeeIdSuffix: string,
    email: string,
  ) {
    const response = await TestRequest.post(
      "/api/admin/employees",
      {
        full_name: "Test Employee Disciplinary",
        nick_name: "Emp Disc",
        email,
        gender: Gender.MALE,
        religion: Religion.ISLAM,
        birth_place: "Jakarta",
        birth_date: new Date("1995-01-01").toISOString(),
        employee_id: `99.99.${employeeIdSuffix}`,
        marital_status: MaritalStatus.SINGLE,
        status: EmployeeStatus.ACTIVE,
        employment_type: EmploymentType.PERMANENT,
        unit_id: masterData.unit.id,
        job_position_id: masterData.position.id,
        job_level_id: masterData.level.id,
        building_id: masterData.building.id,
        join_date: new Date("2026-01-01").toISOString(),
      },
      accessToken,
    );
    const body = await response.json();
    return body.data;
  }

  async function issue(
    accessToken: string,
    employeeId: string,
    payload: Record<string, unknown>,
  ) {
    const response = await TestRequest.post(
      `/api/admin/employees/${employeeId}/disciplinary-actions`,
      payload,
      accessToken,
    );
    const body = await response.json();
    return { response, body };
  }

  it("should page the disciplinary history on the server", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "899", "test_disc_paging@millennia21.id");
    await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "First" });
    await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "Second" });

    const url = `/api/admin/employees/${employee.id}/disciplinary-actions`;
    const first = await (await TestRequest.get(`${url}?page=1&size=1`, accessToken)).json();
    expect(first.data).toHaveLength(1);
    expect(first.paging.total_item).toBe(2);
    expect(first.paging.total_page).toBe(2);

    const second = await (await TestRequest.get(`${url}?page=2&size=1`, accessToken)).json();
    expect(second.data).toHaveLength(1);
    expect(second.data[0].id).not.toBe(first.data[0].id);
  });

  it("should issue ST1 for an employee with no prior disciplinary history", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "801", "test_disc_st1@millennia21.id");

    const { response, body } = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Terlambat berulang kali",
    });
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.type).toBe("SURAT_TEGURAN");
    expect(body.data.level).toBe(1);
    expect(body.data.status).toBe("ACTIVE");
  });

  it("should escalate to ST2 and supersede ST1 when ST1 is still active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "802", "test_disc_st2@millennia21.id");

    const first = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Pelanggaran pertama",
    });
    const second = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Pelanggaran kedua",
    });
    logger.debug(second.body);

    expect(second.response.status).toBe(200);
    expect(second.body.data.level).toBe(2);

    const firstRecord = await prismaClient.employeeDisciplinaryAction.findUnique({
      where: { id: first.body.data.id },
    });
    expect(firstRecord?.status).toBe("SUPERSEDED");
  });

  it("should escalate a backdated ST2 when ST1 was active as of ST2's issued_date, even though both are long expired by today", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "804",
      "test_disc_backdated_escalate@millennia21.id",
    );

    // Historical sequencing uses the new action's issue date, not today.
    const first = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Pelanggaran pertama (backdated)",
      issued_date: new Date("2025-01-01").toISOString(),
    });
    expect(first.response.status).toBe(200);
    expect(first.body.data.level).toBe(1);

    const second = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Pelanggaran kedua (backdated)",
      issued_date: new Date("2025-02-01").toISOString(),
    });
    logger.debug(second.body);

    expect(second.response.status).toBe(200);
    expect(second.body.data.level).toBe(2);

    const firstRecord = await prismaClient.employeeDisciplinaryAction.findUnique({
      where: { id: first.body.data.id },
    });
    expect(firstRecord?.status).toBe("SUPERSEDED");
  });

  it("should NOT escalate a backdated ST2 when ST1 had already expired as of ST2's own issued_date", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "805",
      "test_disc_backdated_no_escalate@millennia21.id",
    );

    const first = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Pelanggaran pertama (backdated)",
      issued_date: new Date("2025-01-01").toISOString(),
      validity_days: 30,
    });
    expect(first.response.status).toBe(200);

    // Issued well after ST1's own 30-day window (2025-01-31) closed -
    // this is a fresh ST1, not an escalation, regardless of today's date.
    const second = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Pelanggaran kedua (backdated, unrelated)",
      issued_date: new Date("2025-03-01").toISOString(),
    });
    logger.debug(second.body);

    expect(second.response.status).toBe(200);
    expect(second.body.data.level).toBe(1);

    const firstRecord = await prismaClient.employeeDisciplinaryAction.findUnique({
      where: { id: first.body.data.id },
    });
    expect(firstRecord?.status).toBe("EXPIRED");
  });

  it("should reject a third Surat Teguran once ST2 is active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "803", "test_disc_st3@millennia21.id");

    await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "1" });
    await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "2" });
    const third = await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "3" });
    logger.debug(third.body);

    expect(third.response.status).toBe(400);
  });

  it("should issue SP1 even when the employee has never had an ST", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "804", "test_disc_sp1@millennia21.id");

    const { response, body } = await issue(accessToken, employee.id, {
      type: "SURAT_PERINGATAN",
      reason: "Pelanggaran berat",
    });
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.level).toBe(1);
  });

  it("should escalate to SP2 and supersede SP1 when SP1 is still active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "805", "test_disc_sp2@millennia21.id");

    const first = await issue(accessToken, employee.id, { type: "SURAT_PERINGATAN", reason: "1" });
    const second = await issue(accessToken, employee.id, { type: "SURAT_PERINGATAN", reason: "2" });
    logger.debug(second.body);

    expect(second.response.status).toBe(200);
    expect(second.body.data.level).toBe(2);

    const firstRecord = await prismaClient.employeeDisciplinaryAction.findUnique({
      where: { id: first.body.data.id },
    });
    expect(firstRecord?.status).toBe("SUPERSEDED");
  });

  it("should reject a third Surat Peringatan once SP2 is active", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "806", "test_disc_sp3@millennia21.id");

    await issue(accessToken, employee.id, { type: "SURAT_PERINGATAN", reason: "1" });
    await issue(accessToken, employee.id, { type: "SURAT_PERINGATAN", reason: "2" });
    const third = await issue(accessToken, employee.id, { type: "SURAT_PERINGATAN", reason: "3" });
    logger.debug(third.body);

    expect(third.response.status).toBe(400);
  });

  it("should reject Surat Teguran when the employee has an active Surat Peringatan", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "807", "test_disc_sp_blocks_st@millennia21.id");

    await issue(accessToken, employee.id, { type: "SURAT_PERINGATAN", reason: "Berat" });
    const { response, body } = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Coba ST setelah SP",
    });
    logger.debug(body);

    expect(response.status).toBe(400);
  });

  it("should supersede an active Surat Teguran when a Surat Peringatan is issued", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "808", "test_disc_sp_supersedes_st@millennia21.id");

    const st = await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "Ringan" });
    const sp = await issue(accessToken, employee.id, { type: "SURAT_PERINGATAN", reason: "Berat" });
    logger.debug(sp.body);

    expect(sp.response.status).toBe(200);

    const stRecord = await prismaClient.employeeDisciplinaryAction.findUnique({
      where: { id: st.body.data.id },
    });
    expect(stRecord?.status).toBe("SUPERSEDED");
  });

  it("should restart at ST1 after a prior ST1 has already expired", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "809", "test_disc_st_reset@millennia21.id");

    // Issued far enough in the past that valid_until (issued_date + 6
    // months) is already behind "now" - create() resolves this inline.
    await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Lama",
      issued_date: new Date("2020-01-01").toISOString(),
    });
    const { response, body } = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Baru, setelah yang lama expired",
    });
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.level).toBe(1);
  });

  it("should resolve an active record", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "810", "test_disc_resolve@millennia21.id");
    const created = await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "X" });

    const response = await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/${created.body.data.id}/resolve`,
      { resolved_reason: "Sudah dibina" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("RESOLVED");
  });

  it("should allow issuing a new ST1 after the active one is resolved early", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "811", "test_disc_resolve_reset@millennia21.id");
    const created = await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "X" });

    await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/${created.body.data.id}/resolve`,
      {},
      accessToken,
    );

    const { response, body } = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Baru setelah resolve",
    });
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.level).toBe(1);
  });

  it("should update reason and notes without touching type/level/status/issued_by", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const admin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { email: "test_superadmin@millennia21.id" },
    });
    const employee = await createEmployee(accessToken, "813", "test_disc_update@millennia21.id");
    const created = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Terlambat 15 menit",
      notes: "Catatan awal",
    });

    const response = await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/${created.body.data.id}`,
      { reason: "Terlambat 30 menit (koreksi)", notes: "Catatan diperbarui" },
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.reason).toBe("Terlambat 30 menit (koreksi)");
    expect(body.data.notes).toBe("Catatan diperbarui");
    expect(body.data.type).toBe("SURAT_TEGURAN");
    expect(body.data.level).toBe(1);
    expect(body.data.status).toBe("ACTIVE");
    expect(body.data.issued_by_admin_name).toBe(admin.full_name);

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AuditAction.UPDATE_DISCIPLINARY_ACTION, admin_id: admin.id },
    });
    expect(auditLog.entity_type).toBe("EmployeeDisciplinaryAction");
    expect(auditLog.old_values).toMatchObject({ reason: "Terlambat 15 menit", notes: "Catatan awal" });
    expect(auditLog.new_values).toMatchObject({
      reason: "Terlambat 30 menit (koreksi)",
      notes: "Catatan diperbarui",
    });
  });

  it("should allow updating a non-ACTIVE (resolved) record", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "814", "test_disc_update_resolved@millennia21.id");
    const created = await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "X" });
    await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/${created.body.data.id}/resolve`,
      {},
      accessToken,
    );

    const response = await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/${created.body.data.id}`,
      { reason: "X - koreksi setelah resolve" },
      accessToken,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("RESOLVED");
    expect(body.data.reason).toBe("X - koreksi setelah resolve");
  });

  it("should reject (400) an update with neither reason nor notes", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "815", "test_disc_update_empty@millennia21.id");
    const created = await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "X" });

    const response = await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/${created.body.data.id}`,
      {},
      accessToken,
    );

    expect(response.status).toBe(400);
  });

  it("should reject (403) update for VIEWER", async () => {
    const { accessToken: superToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(superToken, "816", "test_disc_update_viewer@millennia21.id");
    const created = await issue(superToken, employee.id, { type: "SURAT_TEGURAN", reason: "X" });

    const { accessToken: viewerToken } = await AdminUserTest.createViewer();
    const response = await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/${created.body.data.id}`,
      { reason: "Should not work" },
      viewerToken,
    );

    expect(response.status).toBe(403);
  });

  it("should reject (404) updating a nonexistent record", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "817", "test_disc_update_missing@millennia21.id");

    const response = await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/nonexistent-id`,
      { reason: "X" },
      accessToken,
    );

    expect(response.status).toBe(404);
  });

  it("should revoke a record and reject revoking it twice", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "812", "test_disc_revoke@millennia21.id");
    const created = await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "Salah input" });

    const response = await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/${created.body.data.id}/revoke`,
      {},
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("REVOKED");

    const secondRevoke = await TestRequest.patch(
      `/api/admin/employees/${employee.id}/disciplinary-actions/${created.body.data.id}/revoke`,
      {},
      accessToken,
    );
    expect(secondRevoke.status).toBe(400);
  });

  it("should list disciplinary history newest-first", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "813", "test_disc_list@millennia21.id");
    await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "1" });
    await issue(accessToken, employee.id, { type: "SURAT_TEGURAN", reason: "2" });

    const response = await TestRequest.get(
      `/api/admin/employees/${employee.id}/disciplinary-actions`,
      accessToken,
    );
    const body = await response.json();
    logger.debug(body);

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.data[0].level).toBe(2);
    expect(body.data[1].level).toBe(1);
  });

  it("should record an audit log entry when disciplinary history access is revealed", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      accessToken,
      "819",
      "test_disc_reveal@millennia21.id",
    );

    const response = await TestRequest.post(
      `/api/admin/employees/${employee.id}/disciplinary-actions/access`,
      {},
      accessToken,
    );
    expect(response.status).toBe(200);

    const log = await prismaClient.auditLog.findFirst({
      where: {
        action: AuditAction.ACCESS_EMPLOYEE_DISCIPLINARY_DATA,
        entity_id: employee.id,
        admin_id: "test-super-admin-id",
      },
    });
    expect(log).not.toBeNull();
  });

  it("should reject revealing disciplinary history without view permission", async () => {
    const { accessToken: superToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      superToken,
      "820",
      "test_disc_reveal_denied@millennia21.id",
    );
    const { accessToken } = await AdminUserTest.createViewer(masterData.unit.id, {
      canViewEmployeeDisciplinaryData: false,
    });

    const response = await TestRequest.post(
      `/api/admin/employees/${employee.id}/disciplinary-actions/access`,
      {},
      accessToken,
    );
    expect(response.status).toBe(403);
  });

  it("should allow a same-unit VIEWER with disciplinary read permission", async () => {
    const { accessToken: superToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      superToken,
      "818",
      "test_disc_viewer_read@millennia21.id",
    );
    await issue(superToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Readable",
    });
    const { accessToken } = await AdminUserTest.createViewer(masterData.unit.id, {
      canViewEmployeeDisciplinaryData: true,
    });

    const response = await TestRequest.get(
      `/api/admin/employees/${employee.id}/disciplinary-actions`,
      accessToken,
    );
    expect(response.status).toBe(200);
  });

  it("should apply only employee custom and all-unit scope to cross-unit disciplinary data", async () => {
    const { accessToken: superToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      superToken,
      "819",
      "test_disc_viewer_scope@millennia21.id",
    );
    const otherUnit = await prismaClient.masterUnit.create({
      data: { name: "TEST_DISC_VIEWER_OTHER_UNIT" },
    });
    const { accessToken: scopedToken } = await AdminUserTest.createViewer(otherUnit.id, {
      canViewEmployeeDisciplinaryData: true,
      id: "test-disc-scoped-viewer",
      email: "test_disc_scoped_viewer@millennia21.id",
    });
    const scopedResponse = await TestRequest.get(
      `/api/admin/employees/${employee.id}/disciplinary-actions`,
      scopedToken,
    );
    expect(scopedResponse.status).toBe(404);

    await prismaClient.adminUser.update({
      where: { id: "test-disc-scoped-viewer" },
      data: { can_view_all_student_units: true },
    });
    const studentAllResponse = await TestRequest.get(
      `/api/admin/employees/${employee.id}/disciplinary-actions`,
      scopedToken,
    );
    expect(studentAllResponse.status).toBe(404);

    await prismaClient.adminUserEmployeeViewUnit.create({
      data: {
        admin_id: "test-disc-scoped-viewer",
        unit_id: masterData.unit.id,
      },
    });
    const customUnitResponse = await TestRequest.get(
      `/api/admin/employees/${employee.id}/disciplinary-actions`,
      scopedToken,
    );
    expect(customUnitResponse.status).toBe(200);

    await prismaClient.adminUserEmployeeViewUnit.deleteMany({
      where: { admin_id: "test-disc-scoped-viewer" },
    });
    await prismaClient.adminUser.update({
      where: { id: "test-disc-scoped-viewer" },
      data: { can_view_all_employee_units: true },
    });
    const allUnitResponse = await TestRequest.get(
      `/api/admin/employees/${employee.id}/disciplinary-actions`,
      scopedToken,
    );
    expect(allUnitResponse.status).toBe(200);
  });

  it("should require disciplinary read permission for DATABASE_ADMIN writes", async () => {
    const { accessToken: superToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(
      superToken,
      "820",
      "test_disc_db_manage_permission@millennia21.id",
    );
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
      { canViewEmployeeDisciplinaryData: false },
    );
    const denied = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Denied",
    });
    expect(denied.response.status).toBe(403);

    await prismaClient.adminUser.update({
      where: { id: "test-db-admin-id" },
      data: { can_view_employee_disciplinary_data: true },
    });
    const allowed = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Allowed",
    });
    expect(allowed.response.status).toBe(200);
  });

  it("should enforce own, selected, and all employee-unit coverage for disciplinary writes", async () => {
    const selectedUnit = await prismaClient.masterUnit.create({
      data: { name: "TEST_DISC_SELECTED_UNIT" },
    });
    const selectedEmployee = await EmployeeTest.create({
      email: "test_disc_selected_employee@millennia21.id",
      unitId: selectedUnit.id,
      jobPositionId: masterData.position.id,
      jobLevelId: masterData.level.id,
      buildingId: masterData.building.id,
    });
    const { accessToken } = await AdminUserTest.createDatabaseAdmin(
      masterData.unit.id,
      { canViewEmployeeDisciplinaryData: true },
    );

    const outside = await issue(accessToken, selectedEmployee.employee!.id, {
      type: "SURAT_TEGURAN",
      reason: "Outside",
    });
    expect(outside.response.status).toBe(403);

    await prismaClient.adminUserEmployeeViewUnit.create({
      data: { admin_id: "test-db-admin-id", unit_id: selectedUnit.id },
    });
    const selected = await issue(accessToken, selectedEmployee.employee!.id, {
      type: "SURAT_TEGURAN",
      reason: "Selected",
    });
    expect(selected.response.status).toBe(200);

    await prismaClient.adminUserEmployeeViewUnit.deleteMany({
      where: { admin_id: "test-db-admin-id" },
    });
    await prismaClient.adminUser.update({
      where: { id: "test-db-admin-id" },
      data: { can_view_all_employee_units: true },
    });
    const allUnits = await issue(accessToken, selectedEmployee.employee!.id, {
      type: "SURAT_PERINGATAN",
      reason: "All units",
    });
    expect(allUnits.response.status).toBe(200);

    expect(
      await prismaClient.auditLog.count({
        where: {
          action: AuditAction.UNAUTHORIZED_ACCESS,
          admin_id: "test-db-admin-id",
        },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("should reject issuing for VIEWER role", async () => {
    const { accessToken: superToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(superToken, "814", "test_disc_viewer@millennia21.id");
    const { accessToken: viewerToken } = await AdminUserTest.createViewer();

    const { response } = await issue(viewerToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "X",
    });

    expect(response.status).toBe(403);
  });

  it("auto-expire sweep should flip past-due ACTIVE records to EXPIRED", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "815", "test_disc_sweep@millennia21.id");
    const created = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Lama",
      issued_date: new Date("2020-01-01").toISOString(),
    });

    const count = await DisciplinaryActionService.expirePastDueActions();
    expect(count).toBeGreaterThanOrEqual(1);

    const record = await prismaClient.employeeDisciplinaryAction.findUnique({
      where: { id: created.body.data.id },
    });
    expect(record?.status).toBe("EXPIRED");
  });

  it("should respect a custom validity_days instead of the default ~6 months", async () => {
    const { accessToken } = await AdminUserTest.createSuperAdmin();
    const employee = await createEmployee(accessToken, "816", "test_disc_custom_validity@millennia21.id");

    const issuedDate = new Date("2026-01-01T00:00:00.000Z");
    const { response, body } = await issue(accessToken, employee.id, {
      type: "SURAT_TEGURAN",
      reason: "Ringan, cukup seminggu",
      issued_date: issuedDate.toISOString(),
      validity_days: 7,
    });
    logger.debug(body);

    expect(response.status).toBe(200);
    const expectedValidUntil = new Date(issuedDate);
    expectedValidUntil.setDate(expectedValidUntil.getDate() + 7);
    expect(body.data.valid_until).toBe(expectedValidUntil.toISOString());
  });
});
