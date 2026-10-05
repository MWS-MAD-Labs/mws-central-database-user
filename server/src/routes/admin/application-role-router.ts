import { Hono } from "hono";
import { ApplicationRoleController } from "../../controller/admin/application-entitlement-controller";
import type { AdminVariables } from "../../type/hono-context";

export const applicationRoleRouter = new Hono<{ Variables: AdminVariables }>();

applicationRoleRouter.get("/", (c) => ApplicationRoleController.list(c));
applicationRoleRouter.post("/", (c) => ApplicationRoleController.create(c));
applicationRoleRouter.patch("/:id", (c) => ApplicationRoleController.update(c));
