import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import type { AuditRequestContext } from "../model/audit-log-model";

export function getAuditRequestContext(c: Context): AuditRequestContext {
  let ip_address: string | undefined;
  try {
    ip_address = getConnInfo(c).remote.address;
  } catch {
    // Missing audit metadata must not block the request.
    ip_address = undefined;
  }

  return {
    ip_address,
    user_agent: c.req.header("user-agent"),
  };
}
