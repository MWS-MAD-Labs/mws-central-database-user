import type { Context } from "hono";
import { AdminRole, type AuditAction, type AuditSource } from "../../generated/prisma/client";
import { ResponseError } from "../../error/response-error";
import { prismaClient } from "../../lib/prisma";
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

    const where = {
      action: c.req.query("action") as AuditAction | undefined,
      source: c.req.query("source") as AuditSource | undefined,
      entity_type: c.req.query("entity_type") || undefined,
      OR: search
        ? [
            { entity_id: { contains: search, mode: "insensitive" as const } },
            { admin: { email: { contains: search, mode: "insensitive" as const } } },
            { api_client: { name: { contains: search, mode: "insensitive" as const } } },
          ]
        : undefined,
    };

    const response = await paginate(page, size, {
      count: () => prismaClient.auditLog.count({ where }),
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
