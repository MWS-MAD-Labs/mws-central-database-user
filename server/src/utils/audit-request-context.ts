import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import type { AuditRequestContext } from "../model/audit-log-model";

export function getAuditRequestContext(c: Context): AuditRequestContext {
  let ip_address: string | undefined;
  try {
    ip_address = getConnInfo(c).remote.address;
  } catch {
    // Missing/invalid `server` in env (e.g. a caller that never wired one
    // up) should not block the request just to capture audit metadata.
    ip_address = undefined;
  }

  return {
    ip_address,
    user_agent: c.req.header("user-agent"),
  };
}
