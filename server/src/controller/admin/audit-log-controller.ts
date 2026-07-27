import type { Context } from "hono";
import { AdminRole, type AuditAction, type AuditSource } from "../../generated/prisma/client";
import { ResponseError } from "../../error/response-error";
import { prismaClient } from "../../lib/prisma";
import { paginate } from "../../model/page-model";
import type { AdminVariables } from "../../type/hono-context";

const AUDIT_LOG_SORT_FIELDS = ["created_at", "action", "source"] as const;
type AuditLogSortField = (typeof AUDIT_LOG_SORT_FIELDS)[number];

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

    return c.json(response);
  }
}

function normalizeSortBy(value?: string): AuditLogSortField {
  if (AUDIT_LOG_SORT_FIELDS.includes(value as AuditLogSortField)) {
    return value as AuditLogSortField;
  }
  return "created_at";
}
