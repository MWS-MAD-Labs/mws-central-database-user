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
