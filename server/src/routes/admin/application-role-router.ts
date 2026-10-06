import { Hono } from "hono";
import {
  ApplicationAccessController,
  ApplicationAccessRuleController,
  ApplicationOrganizationController,
  ApplicationRoleController,
} from "../../controller/admin/application-entitlement-controller";
import type { AdminVariables } from "../../type/hono-context";

export const applicationRoleRouter = new Hono<{ Variables: AdminVariables }>();

applicationRoleRouter.get("/", (c) => ApplicationRoleController.list(c));
applicationRoleRouter.post("/", (c) => ApplicationRoleController.create(c));
applicationRoleRouter.patch("/order", (c) => ApplicationRoleController.reorder(c));
applicationRoleRouter.patch("/:id", (c) => ApplicationRoleController.update(c));

export const applicationAccessRuleRouter = new Hono<{ Variables: AdminVariables }>();

applicationAccessRuleRouter.get("/:id", (c) => ApplicationAccessRuleController.get(c));
applicationAccessRuleRouter.post("/", (c) => ApplicationAccessRuleController.create(c));
applicationAccessRuleRouter.patch("/:id", (c) => ApplicationAccessRuleController.update(c));
applicationAccessRuleRouter.delete("/:id", (c) => ApplicationAccessRuleController.remove(c));

export const applicationAccessRouter = new Hono<{ Variables: AdminVariables }>();

applicationAccessRouter.get("/applications", (c) => ApplicationAccessController.applications(c));
applicationAccessRouter.post("/applications", (c) => ApplicationAccessController.createApplication(c));
applicationAccessRouter.get("/apps/:applicationId/exceptions", (c) => ApplicationAccessController.exceptions(c));
applicationAccessRouter.get("/apps/:applicationId", (c) => ApplicationAccessController.application(c));
applicationAccessRouter.get("/candidates", (c) => ApplicationAccessController.candidates(c));
applicationAccessRouter.get("/", (c) => ApplicationAccessController.list(c));

export const applicationOrganizationRouter = new Hono<{ Variables: AdminVariables }>();

applicationOrganizationRouter.get("/", (c) => ApplicationOrganizationController.list(c));
