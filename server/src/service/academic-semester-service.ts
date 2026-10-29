import {
  AuditAction,
  AuditSource,
  Prisma,
  type AcademicSemester,
  type AdminUser,
} from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { ResponseError } from "../error/response-error";
import type { AuditRequestContext } from "../model/audit-log-model";
import {
  toAcademicSemesterAuditSnapshot,
  toAcademicSemesterResponse,
  type AcademicSemesterResponse,
} from "../model/academic-semester-model";
import { AuditService } from "./audit-service";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SEMESTERS = 4;

const day = (value: Date) => value.toISOString().slice(0, 10);

// The middle day of a range, where the first half ends when nothing else was picked.
export function midpointDate(start: Date, end: Date): Date {
  const days = Math.floor((end.getTime() - start.getTime()) / DAY_MS);
  return new Date(start.getTime() + Math.floor(days / 2) * DAY_MS);
}

// Two parts of a year: the first half and the day after it to the end. A year with no end date has no halves to make.
export function defaultSemesterDates(start: Date, end: Date): SemesterInput[] {
  const firstEnd = midpointDate(start, end);
  const secondStart = new Date(firstEnd.getTime() + DAY_MS);
  return [
    { name: semesterName(1), start_date: start, end_date: firstEnd, half_end_date: midpointDate(start, firstEnd) },
    { name: semesterName(2), start_date: secondStart, end_date: end, half_end_date: midpointDate(secondStart, end) },
  ];
}

// A semester from a request: the half defaults to the middle when it was not sent.
export function toSemesterInput(item: { name?: string; start_date: string; end_date: string; half_end_date?: string }): SemesterInput {
  const start = new Date(item.start_date);
  const end = new Date(item.end_date);
  return {
    name: "",
    start_date: start,
    end_date: end,
    half_end_date: item.half_end_date ? new Date(item.half_end_date) : midpointDate(start, end),
  };
}

// The dates have to be inside the year, in order, and not overlap another semester of it.
function assertDatesFit(
  year: { name: string; start_date: Date; end_date: Date | null },
  start: Date,
  end: Date,
  others: Pick<AcademicSemester, "name" | "start_date" | "end_date">[],
) {
  if (start > end) throw new ResponseError(400, "The start date cannot be after the end date");
  if (start < year.start_date || (year.end_date && end > year.end_date)) {
    throw new ResponseError(
      400,
      `The semester has to be inside ${year.name}, which runs from ${day(year.start_date)}${year.end_date ? ` to ${day(year.end_date)}` : ""}`,
    );
  }
  const clash = others.find((other) => start <= other.end_date && end >= other.start_date);
  if (clash) {
    throw new ResponseError(
      400,
      `The dates overlap ${clash.name}, which runs from ${day(clash.start_date)} to ${day(clash.end_date)}`,
    );
  }
}

export type SemesterInput = { name: string; start_date: Date; end_date: Date; half_end_date: Date };

// The name of a semester is its place in the year, never typed.
export const semesterName = (position: number) => `Semester ${position}`;

// Checks a whole set for a new year: order and dates inside the year, no overlap. Names follow the order.
export function assertSemesterSet<T extends SemesterInput>(
  year: { name: string; start_date: Date; end_date: Date | null },
  items: T[],
): T[] {
  if (items.length > MAX_SEMESTERS) {
    throw new ResponseError(400, `A year can have at most ${MAX_SEMESTERS} semesters`);
  }
  const sorted = [...items]
    .sort((a, b) => a.start_date.getTime() - b.start_date.getTime())
    .map((item, index) => ({ ...item, name: semesterName(index + 1) }));
  const seen: T[] = [];
  for (const item of sorted) {
    assertDatesFit(year, item.start_date, item.end_date, seen);
    if (item.half_end_date < item.start_date || item.half_end_date >= item.end_date) {
      throw new ResponseError(
        400,
        `The first half of ${item.name} has to end on a day inside it, before the last day (${day(item.start_date)} to ${day(item.end_date)})`,
      );
    }
    seen.push(item);
  }
  return sorted;
}

// Writes the semesters of a year that was just made, inside its transaction.
export async function createSemestersForYear(
  tx: Prisma.TransactionClient,
  admin: AdminUser,
  yearId: string,
  items: SemesterInput[],
  context: AuditRequestContext = {},
) {
  for (const [index, item] of items.entries()) {
    const row = await tx.academicSemester.create({
      data: { academic_year_id: yearId, position: index + 1, ...item },
    });
    await AuditService.record(
      {
        action: AuditAction.CREATE_ACADEMIC_SEMESTER,
        source: AuditSource.UI,
        entity_type: "AcademicSemester",
        entity_id: row.id,
        admin_id: admin.id,
        new_values: toAcademicSemesterAuditSnapshot(row),
        ip_address: context.ip_address,
        user_agent: context.user_agent,
      },
      tx,
    );
  }
}

export type SemesterChange = SemesterInput & { id?: string };

// Makes the semesters of a year match the list: change the ones with an id, add the rest, remove the others.
export async function syncSemestersForYear(
  tx: Prisma.TransactionClient,
  admin: AdminUser,
  yearId: string,
  items: SemesterChange[],
  context: AuditRequestContext = {},
) {
  const current = await tx.academicSemester.findMany({ where: { academic_year_id: yearId } });
  const byId = new Map(current.map((row) => [row.id, row]));
  for (const item of items) {
    if (item.id && !byId.has(item.id)) throw new ResponseError(404, "Semester not found");
  }
  const keep = new Set(items.flatMap((item) => (item.id ? [item.id] : [])));
  const audit = (
    action: "CREATE_ACADEMIC_SEMESTER" | "UPDATE_ACADEMIC_SEMESTER" | "DELETE_ACADEMIC_SEMESTER",
    id: string,
    extra: { old_values?: ReturnType<typeof toAcademicSemesterAuditSnapshot>; new_values?: ReturnType<typeof toAcademicSemesterAuditSnapshot> },
  ) =>
    AuditService.record(
      {
        action,
        source: AuditSource.UI,
        entity_type: "AcademicSemester",
        entity_id: id,
        admin_id: admin.id,
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        ...extra,
      },
      tx,
    );

  for (const row of current.filter((item) => !keep.has(item.id))) {
    await tx.academicSemester.delete({ where: { id: row.id } });
    await audit(AuditAction.DELETE_ACADEMIC_SEMESTER, row.id, { old_values: toAcademicSemesterAuditSnapshot(row) });
  }
  // Park the kept rows first so a swap of names or places does not hit the unique keys.
  for (const [index, id] of [...keep].entries()) {
    await tx.academicSemester.update({ where: { id }, data: { position: 100 + index, name: `~${id}` } });
  }
  for (const [index, item] of items.entries()) {
    const data = {
      name: item.name,
      position: index + 1,
      start_date: item.start_date,
      end_date: item.end_date,
      half_end_date: item.half_end_date,
    };
    if (item.id) {
      const before = byId.get(item.id)!;
      const row = await tx.academicSemester.update({ where: { id: item.id }, data });
      const changed =
        before.name !== row.name ||
        before.position !== row.position ||
        before.start_date.getTime() !== row.start_date.getTime() ||
        before.end_date.getTime() !== row.end_date.getTime() ||
        before.half_end_date.getTime() !== row.half_end_date.getTime();
      if (changed) {
        await audit(AuditAction.UPDATE_ACADEMIC_SEMESTER, row.id, {
          old_values: toAcademicSemesterAuditSnapshot(before),
          new_values: toAcademicSemesterAuditSnapshot(row),
        });
      }
    } else {
      const row = await tx.academicSemester.create({ data: { academic_year_id: yearId, ...data } });
      await audit(AuditAction.CREATE_ACADEMIC_SEMESTER, row.id, { new_values: toAcademicSemesterAuditSnapshot(row) });
    }
  }
}

export class AcademicSemesterService {
  static async list(academicYearId: string): Promise<AcademicSemesterResponse[]> {
    const year = await prismaClient.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true } });
    if (!year) throw new ResponseError(404, "Academic year not found");
    const rows = await prismaClient.academicSemester.findMany({
      where: { academic_year_id: academicYearId },
      orderBy: { position: "asc" },
    });
    return rows.map(toAcademicSemesterResponse);
  }
}
