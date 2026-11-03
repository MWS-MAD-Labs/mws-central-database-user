import { Hono } from "hono";
import { ApplicationLogoController } from "../../controller/admin/application-logo-controller";
import { attachmentUploadBodyLimit } from "../../middleware/upload-body-limit";
import type { AdminVariables } from "../../type/hono-context";

export const applicationLogoRouter = new Hono<{ Variables: AdminVariables }>();

applicationLogoRouter.get("/", (c) => ApplicationLogoController.list(c));
applicationLogoRouter.post("/", attachmentUploadBodyLimit, (c) => ApplicationLogoController.create(c));
applicationLogoRouter.get("/:id/image", (c) => ApplicationLogoController.image(c));
applicationLogoRouter.patch("/:id", (c) => ApplicationLogoController.rename(c));
applicationLogoRouter.delete("/:id", (c) => ApplicationLogoController.remove(c));
