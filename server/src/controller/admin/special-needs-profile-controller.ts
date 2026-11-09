import type { Context } from "hono";
import { ResponseError } from "../../error/response-error";
import type { SpecialNeedsProfileRequest } from "../../model/special-needs-profile-model";
import { SpecialNeedsProfileService } from "../../service/special-needs-profile-service";
import type { AdminVariables } from "../../type/hono-context";
import { getAuditRequestContext } from "../../utils/audit-request-context";

type Ctx = Context<{ Variables: AdminVariables }>;

const studentId = (c: Ctx) => {
  const id = c.req.param("id");
  if (!id) throw new ResponseError(400, "Student ID is required in parameter");
  return id;
};

export class SpecialNeedsProfileController {
  static async save(c: Ctx) {
    const profile = (await c.req.json()) as SpecialNeedsProfileRequest;
    const data = await SpecialNeedsProfileService.save(c.var.admin, { student_id: studentId(c), profile }, getAuditRequestContext(c));
    return c.json({ data });
  }

  static async get(c: Ctx) {
    const data = await SpecialNeedsProfileService.get(c.var.admin, { student_id: studentId(c) }, getAuditRequestContext(c));
    return c.json({ data });
  }

  static async remove(c: Ctx) {
    await SpecialNeedsProfileService.remove(c.var.admin, { student_id: studentId(c) }, getAuditRequestContext(c));
    return c.json({ data: true });
  }
}
