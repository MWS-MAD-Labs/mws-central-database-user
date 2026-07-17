import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isWithinOfficeHours,
  hasActiveAfterHoursOverride,
  canWriteNow,
  assertCanWriteNow,
} from "../utils/office-hours";
import { AdminRole } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import {
  AdminUserTest,
  MasterDataTest,
  WorkingDayTest,
  AuditLogTest,
} from "./test-utils";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Builds a Date whose WIB (UTC+7) wall-clock reading is exactly y-m-d h:min.
function wib(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min) - WIB_OFFSET_MS);
}

// 2026-01-14 = Wednesday, 2026-01-17 = Saturday, 2026-01-18 = Sunday.
const WEDNESDAY = { y: 2026, m: 1, d: 14 };
const SATURDAY = { y: 2026, m: 1, d: 17 };
const SUNDAY = { y: 2026, m: 1, d: 18 };

describe("isWithinOfficeHours", () => {
  const originalSaturdayDefault = process.env.SATURDAY_DEFAULT_ACTIVE;

  afterEach(async () => {
    await WorkingDayTest.delete();
    if (originalSaturdayDefault === undefined) {
      delete process.env.SATURDAY_DEFAULT_ACTIVE;
    } else {
      process.env.SATURDAY_DEFAULT_ACTIVE = originalSaturdayDefault;
    }
  });

  it("is true on a weekday within 06:30-17:00 WIB", async () => {
    expect(
      await isWithinOfficeHours(
        wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 10, 0),
      ),
    ).toBe(true);
  });

  it("is true exactly at the 06:30 and 17:00 WIB boundaries", async () => {
    expect(
      await isWithinOfficeHours(
        wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 6, 30),
      ),
    ).toBe(true);
    expect(
      await isWithinOfficeHours(
        wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 17, 0),
      ),
    ).toBe(true);
  });

  it("is false before 06:30 or after 17:00 WIB on a weekday", async () => {
    expect(
      await isWithinOfficeHours(
        wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 5, 0),
      ),
    ).toBe(false);
    expect(
      await isWithinOfficeHours(
        wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 17, 1),
      ),
    ).toBe(false);
  });

  it("is false on a Sunday regardless of time", async () => {
    expect(
      await isWithinOfficeHours(wib(SUNDAY.y, SUNDAY.m, SUNDAY.d, 10, 0)),
    ).toBe(false);
  });

  it("is true on a Saturday by default (SATURDAY_DEFAULT_ACTIVE unset), even with no override", async () => {
    delete process.env.SATURDAY_DEFAULT_ACTIVE;
    expect(
      await isWithinOfficeHours(wib(SATURDAY.y, SATURDAY.m, SATURDAY.d, 10, 0)),
    ).toBe(true);
  });

  it("is false on a Saturday with no override once strict mode is enabled (SATURDAY_DEFAULT_ACTIVE=false)", async () => {
    process.env.SATURDAY_DEFAULT_ACTIVE = "false";
    expect(
      await isWithinOfficeHours(wib(SATURDAY.y, SATURDAY.m, SATURDAY.d, 10, 0)),
    ).toBe(false);
  });

  it("is true on a Saturday explicitly designated a working day, even in strict mode", async () => {
    process.env.SATURDAY_DEFAULT_ACTIVE = "false";
    const saturdayDate = WorkingDayTest.nextSaturdayOnOrAfter(2100);
    await prismaClient.workingDayOverride.create({
      data: { date: saturdayDate },
    });

    const workingSaturday = wib(
      saturdayDate.getUTCFullYear(),
      saturdayDate.getUTCMonth() + 1,
      saturdayDate.getUTCDate(),
      10,
      0,
    );
    expect(await isWithinOfficeHours(workingSaturday)).toBe(true);
  });
});

describe("hasActiveAfterHoursOverride", () => {
  const now = wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 20, 0);

  it("is true when after_hours_write_until is in the future relative to now", () => {
    const future = new Date(now.getTime() + 60_000);
    expect(
      hasActiveAfterHoursOverride({ after_hours_write_until: future }, now),
    ).toBe(true);
  });

  it("is false when after_hours_write_until is in the past relative to now", () => {
    const past = new Date(now.getTime() - 60_000);
    expect(
      hasActiveAfterHoursOverride({ after_hours_write_until: past }, now),
    ).toBe(false);
  });

  it("is false when after_hours_write_until is null", () => {
    expect(
      hasActiveAfterHoursOverride({ after_hours_write_until: null }, now),
    ).toBe(false);
  });
});

describe("canWriteNow", () => {
  const inHours = wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 10, 0);
  const outsideHours = wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 22, 0);

  it("is always true for SUPER_ADMIN, even outside office hours", async () => {
    expect(
      await canWriteNow(
        { role: AdminRole.SUPER_ADMIN, after_hours_write_until: null },
        outsideHours,
      ),
    ).toBe(true);
  });

  it("is true for DATABASE_ADMIN within office hours", async () => {
    expect(
      await canWriteNow(
        { role: AdminRole.DATABASE_ADMIN, after_hours_write_until: null },
        inHours,
      ),
    ).toBe(true);
  });

  it("is false for DATABASE_ADMIN outside office hours with no override", async () => {
    expect(
      await canWriteNow(
        { role: AdminRole.DATABASE_ADMIN, after_hours_write_until: null },
        outsideHours,
      ),
    ).toBe(false);
  });

  it("is true for DATABASE_ADMIN outside office hours with an active override", async () => {
    const activeUntil = new Date(outsideHours.getTime() + 60_000);
    expect(
      await canWriteNow(
        {
          role: AdminRole.DATABASE_ADMIN,
          after_hours_write_until: activeUntil,
        },
        outsideHours,
      ),
    ).toBe(true);
  });

  it("is false for DATABASE_ADMIN outside office hours with an expired override", async () => {
    const expiredAt = new Date(outsideHours.getTime() - 60_000);
    expect(
      await canWriteNow(
        {
          role: AdminRole.DATABASE_ADMIN,
          after_hours_write_until: expiredAt,
        },
        outsideHours,
      ),
    ).toBe(false);
  });
});

describe("assertCanWriteNow", () => {
  let masterData: Awaited<ReturnType<typeof MasterDataTest.create>>;
  const outsideHours = wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 22, 0);

  beforeEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
    masterData = await MasterDataTest.create();
  });

  afterEach(async () => {
    await AuditLogTest.delete();
    await AdminUserTest.delete();
    await MasterDataTest.delete();
  });

  it("does not throw when the admin can write right now", async () => {
    const admin = await prismaClient.adminUser.create({
      data: {
        id: "office-hours-test-admin-allowed",
        email: "office_hours_allowed@millennia21.id",
        full_name: "Office Hours Allowed",
        role: AdminRole.DATABASE_ADMIN,
        unit_id: masterData.unit.id,
        can_write_data: true,
        after_hours_write_until: null,
      },
    });

    const inHours = wib(WEDNESDAY.y, WEDNESDAY.m, WEDNESDAY.d, 10, 0);
    await expect(
      assertCanWriteNow(admin, {}, inHours),
    ).resolves.toBeUndefined();
  });

  it("throws 403 and writes an UNAUTHORIZED_ACCESS audit log when blocked", async () => {
    const admin = await prismaClient.adminUser.create({
      data: {
        id: "office-hours-test-admin-blocked",
        email: "office_hours_blocked@millennia21.id",
        full_name: "Office Hours Blocked",
        role: AdminRole.DATABASE_ADMIN,
        unit_id: masterData.unit.id,
        can_write_data: true,
        after_hours_write_until: null,
      },
    });

    await expect(
      assertCanWriteNow(admin, {}, outsideHours),
    ).rejects.toMatchObject({ status: 403 });

    const auditLog = await prismaClient.auditLog.findFirstOrThrow({
      where: { admin_id: admin.id, action: "UNAUTHORIZED_ACCESS" },
    });
    expect(auditLog).toBeDefined();
  });
});
