import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateIdentifierChangeRequest,
  ListIdentifierChangeRequests,
} from "../../model/identifier-change-request-model";
import { IdentifierChangeRequestService } from "../../service/identifier-change-request-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

type AdminContext = Context<{ Variables: AdminVariables }>;

function requireId(c: AdminContext): string {
  const id = c.req.param("id");
  if (!id) throw new ResponseError(400, "Request ID is required in parameter");
  return id;
}

async function optionalNote(c: AdminContext): Promise<string | undefined> {
  const body = (await c.req.json().catch(() => ({}))) as { decision_note?: string };
  return body.decision_note;
}

export class IdentifierChangeRequestController {
  static async list(c: AdminContext) {
    const query = c.req.query() as ListIdentifierChangeRequests;
    const response = await IdentifierChangeRequestService.list(c.var.admin, {
      status: query.status || undefined,
      entity_type: query.entity_type || undefined,
      entity_id: query.entity_id || undefined,
    });
    return c.json(response);
  }

  static async approverStatus(c: AdminContext) {
    return c.json({ data: await IdentifierChangeRequestService.approverStatus() });
  }

  static async get(c: AdminContext) {
    const response = await IdentifierChangeRequestService.get(c.var.admin, requireId(c));
    return c.json({ data: response });
  }

  static async create(c: AdminContext) {
    const body = (await c.req.json()) as CreateIdentifierChangeRequest;
    const response = await IdentifierChangeRequestService.create(
      c.var.admin,
      body,
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async approve(c: AdminContext) {
    const response = await IdentifierChangeRequestService.approve(
      c.var.admin,
      { id: requireId(c), decision_note: await optionalNote(c) },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async reject(c: AdminContext) {
    const response = await IdentifierChangeRequestService.reject(
      c.var.admin,
      { id: requireId(c), decision_note: await optionalNote(c) },
      getAuditRequestContext(c),
    );
    return c.json({ data: response });
  }

  static async cancel(c: AdminContext) {
    const response = await IdentifierChangeRequestService.cancel(c.var.admin, requireId(c));
    return c.json({ data: response });
  }
}
