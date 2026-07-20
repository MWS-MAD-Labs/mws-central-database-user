import type { Context } from "hono";
import type { AdminVariables } from "../../type/hono-context";
import type {
  CreateSimpleMasterDataRequest,
  SearchSimpleMasterDataRequest,
  SimpleMasterDataSortField,
  UpdateSimpleMasterDataRequest,
} from "../../model/simple-master-data-model";
import type { SimpleMasterDataService } from "../../service/simple-master-data-service";
import { ResponseError } from "../../error/response-error";
import { getAuditRequestContext } from "../../utils/audit-request-context";

export function createSimpleMasterDataController(
  service: SimpleMasterDataService,
) {
  return {
    async create(c: Context<{ Variables: AdminVariables }>) {
      const admin = c.var.admin;
      const request = (await c.req.json()) as CreateSimpleMasterDataRequest;

      const response = await service.create(
        admin,
        request,
        getAuditRequestContext(c),
      );

      return c.json({ data: response });
    },

    async update(c: Context<{ Variables: AdminVariables }>) {
      const admin = c.var.admin;
      const id = c.req.param("id");

      if (!id) {
        throw new ResponseError(400, "ID is required in parameter");
      }

      const request = (await c.req.json()) as UpdateSimpleMasterDataRequest;

      const response = await service.update(
        admin,
        { ...request, id },
        getAuditRequestContext(c),
      );

      return c.json({ data: response });
    },

    async remove(c: Context<{ Variables: AdminVariables }>) {
      const admin = c.var.admin;
      const id = c.req.param("id");

      if (!id) {
        throw new ResponseError(400, "ID is required in parameter");
      }

      const response = await service.remove(
        admin,
        { id },
        getAuditRequestContext(c),
      );

      return c.json({ data: response });
    },

    async get(c: Context<{ Variables: AdminVariables }>) {
      const admin = c.var.admin;
      const id = c.req.param("id");

      if (!id) {
        throw new ResponseError(400, "ID is required in parameter");
      }

      const response = await service.get(admin, { id });

      return c.json({ data: response });
    },

    async search(c: Context<{ Variables: AdminVariables }>) {
      const admin = c.var.admin;

      const request: SearchSimpleMasterDataRequest = {
        page: c.req.query("page") ? Number(c.req.query("page")) : 1,
        size: c.req.query("size") ? Number(c.req.query("size")) : 10,
        search: c.req.query("search"),
        sort_by: c.req.query("sort_by") as
          | SimpleMasterDataSortField
          | undefined,
        sort_order: c.req.query("sort_order") as "asc" | "desc" | undefined,
      };

      if (Number.isNaN(request.page)) {
        throw new ResponseError(400, "page must be a valid number");
      }
      if (Number.isNaN(request.size)) {
        throw new ResponseError(400, "size must be a valid number");
      }

      const response = await service.search(admin, request);

      return c.json(response);
    },
  };
}
