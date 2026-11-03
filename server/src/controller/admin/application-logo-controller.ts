import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import { ApplicationLogoService } from "../../service/application-logo-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export class ApplicationLogoController {
  static async list(c: Context<{ Variables: AdminVariables }>) {
    return c.json({ data: await ApplicationLogoService.list() });
  }

  static async create(c: Context<{ Variables: AdminVariables }>) {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw new ResponseError(400, "A picture is required under the 'file' field");
    }
    const name = typeof body["name"] === "string" ? body["name"] : "";
    const data = await ApplicationLogoService.create(c.var.admin, name, file, getAuditRequestContext(c));
    return c.json({ data });
  }

  static async rename(c: Context<{ Variables: AdminVariables }>) {
    const body = (await c.req.json()) as { name?: string };
    const data = await ApplicationLogoService.rename(
      c.var.admin,
      c.req.param("id")!,
      body.name ?? "",
      getAuditRequestContext(c),
    );
    return c.json({ data });
  }

  static async remove(c: Context<{ Variables: AdminVariables }>) {
    const data = await ApplicationLogoService.remove(c.var.admin, c.req.param("id")!, getAuditRequestContext(c));
    return c.json({ data });
  }

  static async image(c: Context<{ Variables: AdminVariables }>) {
    const { buffer, contentType, version } = await ApplicationLogoService.image(c.req.param("id")!);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        ETag: `"v${version}"`,
      },
    });
  }
}
