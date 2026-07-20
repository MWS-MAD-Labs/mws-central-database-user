import { describe, afterEach, beforeEach, it, expect } from "bun:test";
import { EmployeeService } from "../service/employee-service";
import { AdminUserTest, MasterDataTest, EmployeeTest } from "./test-utils";
import { prismaClient } from "../lib/prisma";
import {
  AdminRole,
  EmploymentType,
  Gender,
  MaritalStatus,
  Religion,
  type MasterUnit,
  type MasterJobPosition,
  type MasterJobLevel,
  EmployeeStatus,
} from "../generated/prisma/client";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Builds a Date whose WIB (UTC+7) wall-clock reading is exactly y-m-d h:min.
function wib(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min) - WIB_OFFSET_MS);
}

// 2026-01-14 = Wednesday.
const IN_HOURS = wib(2026, 1, 14, 10, 0);
const OUTSIDE_HOURS = wib(2026, 1, 14, 22, 0);

describe("EmployeeService respects the office-hours write gate (direct service calls, deterministic `now`)", () => {
  let masterData: {
    unit: MasterUnit;
    position: MasterJobPosition;
    level: MasterJobLevel;
  };

  beforeEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AdminUserTest.delete();
    await EmployeeTest.delete();
    await MasterDataTest.delete();
  });

  const buildRequest = (email: string, employeeId: string) => ({
    full_name: "Gate Test Employee",
    nick_name: "Gate",
    email,
    gender: Gender.MALE,
    religion: Religion.ISLAM,
    birth_place: "Jakarta",
    birth_date: new Date("1995-01-01").toISOString(),
    employee_id: employeeId,
    marital_status: MaritalStatus.SINGLE,
    status: EmployeeStatus.ACTIVE,
    employment_type: EmploymentType.PERMANENT,
    unit_id: masterData.unit.id,
    job_position_id: masterData.position.id,
    job_level_id: masterData.level.id,
    building: "Main Building",
    join_date: new Date("2026-01-01").toISOString(),
  });

  it("blocks a DATABASE_ADMIN create outside office hours with no override", async () => {
    const dbAdmin = await prismaClient.adminUser.create({
      data: {
        id: "gate-test-admin-blocked-create",
        email: "gate_blocked_create@millennia21.id",
        full_name: "Gate Blocked",
        role: AdminRole.DATABASE_ADMIN,
        unit_id: masterData.unit.id,
        can_write_data: true,
        after_hours_write_until: null,
      },
    });

    await expect(
      EmployeeService.create(
        dbAdmin,
        buildRequest("99_99_gate1@millennia21.id", "99.99.910"),
        {},
        OUTSIDE_HOURS,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows a DATABASE_ADMIN create within office hours", async () => {
    const dbAdmin = await prismaClient.adminUser.create({
      data: {
        id: "gate-test-admin-allowed-create",
        email: "gate_allowed_create@millennia21.id",
        full_name: "Gate Allowed",
        role: AdminRole.DATABASE_ADMIN,
        unit_id: masterData.unit.id,
        can_write_data: true,
        after_hours_write_until: null,
      },
    });

    const response = await EmployeeService.create(
      dbAdmin,
      buildRequest("gate_allowed_create_emp@millennia21.id", "99.99.911"),
      {},
      IN_HOURS,
    );

    expect(response.identity.full_name).toBe("Gate Test Employee");
  });

  it("allows a DATABASE_ADMIN create outside office hours when an active override is set", async () => {
    const dbAdmin = await prismaClient.adminUser.create({
      data: {
        id: "gate-test-admin-override-create",
        email: "gate_override_create@millennia21.id",
        full_name: "Gate Override",
        role: AdminRole.DATABASE_ADMIN,
        unit_id: masterData.unit.id,
        can_write_data: true,
        after_hours_write_until: new Date(OUTSIDE_HOURS.getTime() + 60_000),
      },
    });

    const response = await EmployeeService.create(
      dbAdmin,
      buildRequest("gate_override_create_emp@millennia21.id", "99.99.912"),
      {},
      OUTSIDE_HOURS,
    );

    expect(response.identity.full_name).toBe("Gate Test Employee");
  });

  it("blocks a DATABASE_ADMIN update outside office hours with no override", async () => {
    const dbAdmin = await prismaClient.adminUser.create({
      data: {
        id: "gate-test-admin-blocked-update",
        email: "gate_blocked_update@millennia21.id",
        full_name: "Gate Blocked Update",
        role: AdminRole.DATABASE_ADMIN,
        unit_id: masterData.unit.id,
        can_write_data: true,
        after_hours_write_until: new Date(IN_HOURS.getTime() + 60_000), // active during the create below
      },
    });

    const created = await EmployeeService.create(
      dbAdmin,
      buildRequest("gate_blocked_update_emp@millennia21.id", "99.99.913"),
      {},
      IN_HOURS,
    );

    // Revoke the override before attempting the update outside hours.
    await prismaClient.adminUser.update({
      where: { id: dbAdmin.id },
      data: { after_hours_write_until: null },
    });
    const refreshedAdmin = await prismaClient.adminUser.findUniqueOrThrow({
      where: { id: dbAdmin.id },
    });

    await expect(
      EmployeeService.update(
        refreshedAdmin,
        { id: created.id, building: "South Wing" },
        {},
        OUTSIDE_HOURS,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
