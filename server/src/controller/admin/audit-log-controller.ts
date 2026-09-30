import type { Context } from "hono";
import { AdminRole, type AuditAction, type AuditSource } from "../../generated/prisma/client";
import { ResponseError } from "../../error/response-error";
import { prismaClient } from "../../lib/prisma";
import { withCountCache } from "../../lib/count-cache";
import { paginate } from "../../model/page-model";
import type { AdminVariables } from "../../type/hono-context";

const AUDIT_LOG_SORT_FIELDS = ["created_at", "action", "source"] as const;
type AuditLogSortField = (typeof AUDIT_LOG_SORT_FIELDS)[number];

// Prefer full_name, name, then email; the UI falls back to entity_id.
// Import-job rows (including older ones with no entity columns) are named
// after the imported entity and file.
function deriveEntityLabel(
  oldValues: unknown,
  newValues: unknown,
): string | null {
  for (const values of [newValues, oldValues]) {
    if (!values || typeof values !== "object") continue;
    const record = values as Record<string, unknown>;
    if (typeof record.job_id === "string" && typeof record.entity === "string") {
      const file =
        typeof record.file_name === "string" && record.file_name
          ? `: ${record.file_name}`
          : "";
      return `${record.entity} import${file}`;
    }
    const label = record.full_name ?? record.name ?? record.email;
    if (typeof label === "string" && label.trim()) return label;
  }
  return null;
}

// Resolve audit foreign keys to display labels in batches.
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

async function fetchInternNames(ids: string[]) {
  const rows = await prismaClient.intern.findMany({
    where: { id: { in: ids } },
    select: { id: true, full_name: true },
  });
  return new Map(rows.map((row) => [row.id, row.full_name]));
}

// Consent type is the record's display label.
async function fetchConsentLabels(ids: string[]) {
  const rows = await prismaClient.consentRecord.findMany({
    where: { id: { in: ids } },
    select: { id: true, consent_type: true },
  });
  return new Map(rows.map((row) => [row.id, row.consent_type]));
}

async function fetchDisciplinaryActionLabels(ids: string[]) {
  const rows = await prismaClient.employeeDisciplinaryAction.findMany({
    where: { id: { in: ids } },
    select: { id: true, type: true },
  });
  return new Map(rows.map((row) => [row.id, row.type]));
}

async function fetchAdminEmails(ids: string[]) {
  const rows = await prismaClient.adminUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true },
  });
  return new Map(rows.map((row) => [row.id, row.email]));
}

const FK_FIELD_RESOLVERS: Record<
  string,
  (ids: string[]) => Promise<Map<string, string>>
> = {
  current_grade_id: fetchGradeNames,
  join_grade_id: fetchGradeNames,
  grade_id: fetchGradeNames,
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
  // Keep resolving the legacy global mentor audit key.
  default_mentor_id: fetchEmployeeNames,
  intern_id: fetchInternNames,
  consent_id: fetchConsentLabels,
  disciplinary_action_id: fetchDisciplinaryActionLabels,
  target_admin_id: fetchAdminEmails,
};

// Fetch each foreign-key type once per audit page.
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

    // Require a bounded indexed date range to avoid full-table scans.
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
      // Cache counts by the complete filter set.
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
              // Filled after the page-wide foreign-key lookup.
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

const MAX_DATE_RANGE_DAYS = 30;
const MAX_DATE_RANGE_MS = MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Boundaries are local wall-clock dates, so compare local calendar days.
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

  // Require both boundaries to keep the query bounded.
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
    // Compare calendar dates because the end boundary includes the full day.
    if (calendarDaysBetween(dateFrom, dateTo) > MAX_DATE_RANGE_DAYS) {
      throw new ResponseError(
        400,
        `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
      );
    }
    return { dateFrom, dateTo };
  }

  // Default to a bounded recent window.
  const now = new Date();
  return { dateFrom: new Date(now.getTime() - MAX_DATE_RANGE_MS), dateTo: now };
}
