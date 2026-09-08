import type { Context } from "hono";
import { AdminRole, type AuditAction, type AuditSource } from "../../generated/prisma/client";
import { ResponseError } from "../../error/response-error";
import { prismaClient } from "../../lib/prisma";
import { withCountCache } from "../../lib/count-cache";
import { paginate } from "../../model/page-model";
import type { AdminVariables } from "../../type/hono-context";

const AUDIT_LOG_SORT_FIELDS = ["created_at", "action", "source"] as const;
type AuditLogSortField = (typeof AUDIT_LOG_SORT_FIELDS)[number];

// A raw entity_id (cuid) tells an admin nothing about who/what it was -
// old_values/new_values already carry a human-readable name for the two
// entities audited most (Student/Employee snapshots both include
// full_name; see toStudentAuditSnapshot/toEmployeeAuditSnapshot), so pull
// it from there instead of an extra lookup per row. Falls through to
// `name` for entities that use that field instead (ApiClient, master
// data). Returns null - not the id - when nothing usable is found, so the
// UI can fall back to showing the id on its own rather than a duplicate.
function deriveEntityLabel(
  oldValues: unknown,
  newValues: unknown,
): string | null {
  for (const values of [newValues, oldValues]) {
    if (!values || typeof values !== "object") continue;
    const record = values as Record<string, unknown>;
    const label = record.full_name ?? record.name;
    if (typeof label === "string" && label.trim()) return label;
  }
  return null;
}

// Field names in the audit snapshots (student-model.ts/employee-model.ts/
// enrollment-model.ts's to*AuditSnapshot()) that hold a foreign key rather
// than a human-readable value - each one maps to a batch fetcher so the
// diff view can show "Grade 2" instead of a raw cuid. student_id resolves
// through Person since Student itself has no name field of its own.
async function fetchGradeNames(ids: string[]) {
  const rows = await prismaClient.grade.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function fetchAcademicYearNames(ids: string[]) {
  const rows = await prismaClient.academicYear.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function fetchUnitNames(ids: string[]) {
  const rows = await prismaClient.masterUnit.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function fetchJobPositionNames(ids: string[]) {
  const rows = await prismaClient.masterJobPosition.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function fetchJobLevelNames(ids: string[]) {
  const rows = await prismaClient.masterJobLevel.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function fetchBuildingNames(ids: string[]) {
  const rows = await prismaClient.masterBuilding.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function fetchClassNames(ids: string[]) {
  const rows = await prismaClient.class.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function fetchStudentNames(ids: string[]) {
  const rows = await prismaClient.student.findMany({
    where: { id: { in: ids } },
    select: { id: true, person: { select: { full_name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.person.full_name]));
}

async function fetchEmployeeNames(ids: string[]) {
  const rows = await prismaClient.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true, person: { select: { full_name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.person.full_name]));
}

async function fetchPcActivityNames(ids: string[]) {
  const rows = await prismaClient.masterPCActivity.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

const FK_FIELD_RESOLVERS: Record<
  string,
  (ids: string[]) => Promise<Map<string, string>>
> = {
  current_grade_id: fetchGradeNames,
  join_grade_id: fetchGradeNames,
  join_academic_year_id: fetchAcademicYearNames,
  academic_year_id: fetchAcademicYearNames,
  unit_id: fetchUnitNames,
  job_position_id: fetchJobPositionNames,
  job_level_id: fetchJobLevelNames,
  building_id: fetchBuildingNames,
  class_id: fetchClassNames,
  student_id: fetchStudentNames,
  employee_id: fetchEmployeeNames,
  mentor_id: fetchEmployeeNames,
  activity_id: fetchPcActivityNames,
  // Legacy key - MasterPCActivity briefly had a single global
  // default_mentor_id (before it moved to per-unit PCActivityDefaultMentor
  // rows), so old audit history still carries this key.
  default_mentor_id: fetchEmployeeNames,
};

// Batched across the whole page (one query per FK type, not per row) so a
// 20-row page of Student updates costs ~2 extra queries (grade,
// academic year), not 40. Every row gets the same shared map back - looking
// up an id that row doesn't actually reference is harmless, and building a
// per-row subset would cost more than it saves.
async function resolveFkLabels(
  logs: Array<{ old_values: unknown; new_values: unknown }>,
): Promise<Record<string, string>> {
  const idsByField = new Map<string, Set<string>>();

  for (const log of logs) {
    for (const values of [log.old_values, log.new_values]) {
      if (!values || typeof values !== "object") continue;
      for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
        if (typeof value !== "string" || !(field in FK_FIELD_RESOLVERS)) continue;
        if (!idsByField.has(field)) idsByField.set(field, new Set());
        idsByField.get(field)!.add(value);
      }
    }
  }

  const merged: Record<string, string> = {};
  await Promise.all(
    Array.from(idsByField.entries()).map(async ([field, ids]) => {
      const resolved = await FK_FIELD_RESOLVERS[field]!(Array.from(ids));
      for (const [id, name] of resolved) merged[id] = name;
    }),
  );

  return merged;
}

export class AuditLogController {
  static async search(c: Context<{ Variables: AdminVariables }>) {
    const admin = c.var.admin;
    if (admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ResponseError(403, "Forbidden: Only Super Admin can view audit logs");
    }

    const page = c.req.query("page") ? Number(c.req.query("page")) : 1;
    const size = c.req.query("size") ? Number(c.req.query("size")) : 20;
    if (Number.isNaN(page)) throw new ResponseError(400, "page must be a valid number");
    if (Number.isNaN(size)) throw new ResponseError(400, "size must be a valid number");

    const sortBy = normalizeSortBy(c.req.query("sort_by"));
    const sortOrder = c.req.query("sort_order") === "asc" ? "asc" : "desc";
    const search = c.req.query("search");

    // Range, not fixed presets - the frontend computes date_from/date_to
    // for whatever bucket the admin picked (this month, a specific past
    // month, a custom range), so history from any period is reachable the
    // same way recent history is, instead of the search being limited to a
    // hardcoded "today/last 7 days" window. created_at already has a DB
    // index (see schema.prisma), so this filters efficiently even as the
    // table grows.
    //
    // A range is mandatory, not optional - an unbounded "give me
    // everything" query is exactly the expensive full-table scan this
    // filter exists to prevent, and the frontend's own "All time" option
    // would otherwise make MAX_DATE_RANGE_DAYS pointless (it could just be
    // skipped). Enforced here, not just in the UI, since nothing stops a
    // direct API call from omitting both params.
    const { dateFrom, dateTo } = resolveDateRange(
      c.req.query("date_from"),
      c.req.query("date_to"),
    );

    const where = {
      action: c.req.query("action") as AuditAction | undefined,
      source: c.req.query("source") as AuditSource | undefined,
      entity_type: c.req.query("entity_type") || undefined,
      created_at: { gte: dateFrom, lte: dateTo },
      OR: search
        ? [
            { entity_id: { contains: search, mode: "insensitive" as const } },
            { admin: { email: { contains: search, mode: "insensitive" as const } } },
            { api_client: { name: { contains: search, mode: "insensitive" as const } } },
          ]
        : undefined,
    };

    const response = await paginate(page, size, {
      // The exact filter combination is the cache key - a search/action/
      // source/entity_type change is a genuinely different count, not a
      // stale one.
      count: () =>
        withCountCache("audit_logs", JSON.stringify(where), () =>
          prismaClient.auditLog.count({ where }),
        ),
      findMany: () =>
        prismaClient.auditLog
          .findMany({
            where,
            take: size,
            skip: (page - 1) * size,
            orderBy: { [sortBy]: sortOrder },
            include: {
              admin: { select: { id: true, email: true, role: true } },
              api_client: { select: { id: true, name: true, token_prefix: true } },
            },
          })
          .then((logs) =>
            logs.map((log) => ({
              id: log.id,
              action: log.action,
              source: log.source,
              entity_type: log.entity_type,
              entity_id: log.entity_id,
              entity_label: deriveEntityLabel(log.old_values, log.new_values),
              // filled in below, once every row on the page is fetched -
              // batching the FK lookups needs the whole page first.
              resolved_labels: {} as Record<string, string>,
              old_values: log.old_values,
              new_values: log.new_values,
              ip_address: log.ip_address,
              user_agent: log.user_agent,
              created_at: log.created_at.toISOString(),
              admin: log.admin,
              api_client: log.api_client,
            })),
          ),
    });

    const resolvedLabels = await resolveFkLabels(response.data);
    for (const log of response.data) {
      log.resolved_labels = resolvedLabels;
    }

    return c.json(response);
  }
}

function normalizeSortBy(value?: string): AuditLogSortField {
  if (AUDIT_LOG_SORT_FIELDS.includes(value as AuditLogSortField)) {
    return value as AuditLogSortField;
  }
  return "created_at";
}

function parseDateBoundary(
  value: string | undefined,
  paramName: "date_from" | "date_to",
): Date | undefined {
  if (!value) return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ResponseError(400, `${paramName} must be a valid date`);
  }
  return parsed;
}

const MAX_DATE_RANGE_DAYS = 90;
const MAX_DATE_RANGE_MS = MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Local getters, not UTC ones - date_from/date_to arrive with no timezone
// designator (e.g. "2026-06-10T00:00:00.000"), so `new Date(...)` already
// parsed them as this server's local wall-clock time. Re-reading them back
// out with the UTC getters would silently shift the calendar date by a day
// whenever the server isn't in UTC (e.g. WIB, UTC+7 - a local midnight
// lands on the previous UTC day), turning a genuine 90-day pick into 91.
function calendarDaysBetween(a: Date, b: Date): number {
  const startOfA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startOfB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((startOfB - startOfA) / ONE_DAY_MS);
}

function resolveDateRange(
  dateFromRaw: string | undefined,
  dateToRaw: string | undefined,
): { dateFrom: Date; dateTo: Date } {
  const dateFrom = parseDateBoundary(dateFromRaw, "date_from");
  const dateTo = parseDateBoundary(dateToRaw, "date_to");

  // Both-or-neither - one side alone leaves the other end unbounded (e.g.
  // date_from with no date_to means "everything since X, no matter how
  // much"), which is the same unbounded-scan problem a missing range has.
  if (Boolean(dateFrom) !== Boolean(dateTo)) {
    throw new ResponseError(
      400,
      "date_from and date_to must be provided together",
    );
  }

  if (dateFrom && dateTo) {
    if (dateFrom.getTime() > dateTo.getTime()) {
      throw new ResponseError(400, "date_from must be before date_to");
    }
    // Calendar days, not a raw millisecond gap - the frontend sends
    // date_from at 00:00:00.000 and date_to at 23:59:59.999 so that
    // date_to's own day is fully included, which makes a UI-picked "90
    // days apart" span read as slightly over 90*24h in raw milliseconds.
    // Comparing calendar dates instead means a real 90-day pick is never
    // rejected for time-of-day reasons that have nothing to do with how
    // many days were actually selected.
    if (calendarDaysBetween(dateFrom, dateTo) > MAX_DATE_RANGE_DAYS) {
      throw new ResponseError(
        400,
        `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
      );
    }
    return { dateFrom, dateTo };
  }

  // Neither given - default to the most recent window instead of an
  // unbounded scan, so a bare GET (no query string at all) is just as
  // bounded as one that explicitly picked a range.
  const now = new Date();
  return { dateFrom: new Date(now.getTime() - MAX_DATE_RANGE_MS), dateTo: now };
}
