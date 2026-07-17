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

// Indonesia (WIB) never observes daylight saving, so a fixed UTC+7 offset is
// always correct — no need for Intl/timezone-database lookups.
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

// Whether Saturday behaves like a normal working day by default, without
// needing a per-date WorkingDayOverride row. Starts out `true` (lenient) so
// Super Admin isn't stuck toggling every Saturday manually while it's still
// unclear how often that's actually needed. Flip SATURDAY_DEFAULT_ACTIVE=false
// once it's confirmed the stricter allow-list (WorkingDayOverride) is
// actually required — no code change needed, just the env var.
function isSaturdayActiveByDefault(): boolean {
  return process.env.SATURDAY_DEFAULT_ACTIVE !== "false";
}

// A WorkingDayOverride only ever matters for Saturdays (Mon-Fri are already
// working days, Sunday is always off regardless) — reject anything else at
// the door so the override list can't silently contain dead entries.
export function toWibMidnightIfSaturday(date: Date): Date | null {
  const { dayOfWeek, utcMidnight } = toWibParts(date);
  return dayOfWeek === 6 ? utcMidnight : null;
}

export async function isWithinOfficeHours(
  date: Date = new Date(),
): Promise<boolean> {
  const { dayOfWeek, minutesOfDay, utcMidnight } = toWibParts(date);

  if (dayOfWeek === 0) return false; // Sunday — always off
  if (
    dayOfWeek === 6 &&
    !isSaturdayActiveByDefault() &&
    !(await isWorkingSaturday(utcMidnight))
  ) {
    return false; // Strict mode — Saturday off unless explicitly designated
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

// DATABASE_ADMIN writes are gated to office hours unless a Super Admin has
// granted a time-boxed emergency exception. Super Admin itself is never
// subject to this — they need to stay reachable to respond to incidents at
// any hour, including revoking a compromised DATABASE_ADMIN account.
//
// `now` defaults to the real clock in production; tests pass an explicit
// value so this stays deterministic regardless of when the suite runs.
export async function canWriteNow(
  admin: Pick<AdminUser, "role" | "after_hours_write_until">,
  now: Date = new Date(),
): Promise<boolean> {
  if (admin.role !== AdminRole.DATABASE_ADMIN) return true;
  if (await isWithinOfficeHours(now)) return true;
  return hasActiveAfterHoursOverride(admin, now);
}

// Throws (and audit-logs the blocked attempt) if the admin can't write right
// now. Centralized here so every write path (Employee today, Student later)
// gets the same gate and the same UNAUTHORIZED_ACCESS trail for free.
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
