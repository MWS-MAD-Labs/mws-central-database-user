import { Hono } from "hono";
import { AuditLogController } from "../../controller/admin/audit-log-controller";
import type { AdminVariables } from "../../type/hono-context";

export const auditLogRouter = new Hono<{ Variables: AdminVariables }>();

auditLogRouter.get("/", (c) => AuditLogController.search(c));
