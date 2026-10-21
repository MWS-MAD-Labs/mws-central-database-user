import { Hono } from "hono";
import { GoogleController } from "../../controller/admin/google-controller";
import type { AdminVariables } from "../../type/hono-context";

export const googleRouter = new Hono<{ Variables: AdminVariables }>();

googleRouter.get("/email-availability", (c) => GoogleController.emailAvailability(c));
googleRouter.get("/link-existing", (c) => GoogleController.linkPreview(c));
googleRouter.post("/link-existing", (c) => GoogleController.linkExisting(c));
