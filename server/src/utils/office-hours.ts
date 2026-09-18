import {
  AdminRole,
  AuditAction,
  AuditSource,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import { AuditService } from "../service/audit-service";

// WIB is fixed at UTC+7 with no daylight saving time.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export const AFTER_HOURS_GRANT_MAX_MINUTES = 4 * 60;

function parseHourMinute(raw: string | undefined, fallback: string): number {
  const [hour, minute] = (raw || fallback).split(":").map(Number);
  return hour * 60 + minute;
}

function toWibParts(date: Date): { dayOfWeek: number; minutesOfDay: number; utcMidnight: Date } {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  return {
    dayOfWeek: wib.getUTCDay(),
    minutesOfDay: wib.getUTCHours() * 60 + wib.getUTCMinutes(),
    utcMidnight: new Date(
      Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()),
    ),
  };
}

async function isWorkingSaturday(utcMidnight: Date): Promise<boolean> {
  const override = await prismaClient.workingDayOverride.findUnique({
    where: { date: utcMidnight },
  });
  return override !== null;
}

// Saturday defaults to active unless strict overrides are enabled.
function isSaturdayActiveByDefault(): boolean {
  return process.env.SATURDAY_DEFAULT_ACTIVE !== "false";
}

// Overrides apply only to Saturdays.
export function toWibMidnightIfSaturday(date: Date): Date | null {
  const { dayOfWeek, utcMidnight } = toWibParts(date);
  return dayOfWeek === 6 ? utcMidnight : null;
}

export async function isWithinOfficeHours(
  date: Date = new Date(),
): Promise<boolean> {
  const { dayOfWeek, minutesOfDay, utcMidnight } = toWibParts(date);

  if (dayOfWeek === 0) return false; // Sunday is always off.
  if (
    dayOfWeek === 6 &&
    !isSaturdayActiveByDefault() &&
    !(await isWorkingSaturday(utcMidnight))
  ) {
    return false; // Strict mode requires an explicit Saturday override.
  }

  const startMinutes = parseHourMinute(process.env.OFFICE_HOURS_START, "06:30");
  const endMinutes = parseHourMinute(process.env.OFFICE_HOURS_END, "17:00");

  return minutesOfDay >= startMinutes && minutesOfDay <= endMinutes;
}

export function hasActiveAfterHoursOverride(
  admin: Pick<AdminUser, "after_hours_write_until">,
  now: Date = new Date(),
): boolean {
  return (
    admin.after_hours_write_until !== null &&
    admin.after_hours_write_until.getTime() > now.getTime()
  );
}

// Database admins need office hours or an active emergency exception.
// Super admins remain available for incident response.
export async function canWriteNow(
  admin: Pick<AdminUser, "role" | "after_hours_write_until">,
  now: Date = new Date(),
): Promise<boolean> {
  if (admin.role !== AdminRole.DATABASE_ADMIN) return true;
  if (await isWithinOfficeHours(now)) return true;
  return hasActiveAfterHoursOverride(admin, now);
}

// Audit blocked writes before rejecting them.
export async function assertCanWriteNow(
  admin: AdminUser,
  context: AuditRequestContext = {},
  now: Date = new Date(),
): Promise<void> {
  if (await canWriteNow(admin, now)) return;

  await AuditService.record({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    source: AuditSource.UI,
    admin_id: admin.id,
    new_values: { reason: "write attempted outside office hours" },
    ip_address: context.ip_address,
    user_agent: context.user_agent,
  });

  throw new ResponseError(
    403,
    "Forbidden: Writes are only allowed during office hours (06:30-17:00 WIB, working days) unless you have an active emergency write grant",
  );
}
