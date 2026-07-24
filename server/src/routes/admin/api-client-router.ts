import { Hono } from "hono";
import { ApiClientController } from "../../controller/admin/api-client-controller";
import type { AdminVariables } from "../../type/hono-context";

export const apiClientRouter = new Hono<{ Variables: AdminVariables }>();

apiClientRouter.post("/", (c) => ApiClientController.create(c));
apiClientRouter.get("/", (c) => ApiClientController.list(c));
apiClientRouter.patch("/revoke/:id", (c) => ApiClientController.revoke(c));
apiClientRouter.patch("/rotate/:id", (c) => ApiClientController.rotate(c));
