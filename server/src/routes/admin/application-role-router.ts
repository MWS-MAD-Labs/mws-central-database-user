import { Hono } from "hono";
import {
  ApplicationAccessController,
  ApplicationAccessRuleController,
  ApplicationOrganizationController,
  ApplicationPermissionController,
  ApplicationRoleController,
} from "../../controller/admin/application-entitlement-controller";
import type { AdminVariables } from "../../type/hono-context";

export const applicationRoleRouter = new Hono<{ Variables: AdminVariables }>();

applicationRoleRouter.get("/", (c) => ApplicationRoleController.list(c));
applicationRoleRouter.post("/", (c) => ApplicationRoleController.create(c));
applicationRoleRouter.patch("/order", (c) => ApplicationRoleController.reorder(c));
applicationRoleRouter.patch("/:id", (c) => ApplicationRoleController.update(c));
applicationRoleRouter.delete("/:id", (c) => ApplicationRoleController.remove(c));

export const applicationAccessRuleRouter = new Hono<{ Variables: AdminVariables }>();

applicationAccessRuleRouter.get("/:id", (c) => ApplicationAccessRuleController.get(c));
applicationAccessRuleRouter.post("/", (c) => ApplicationAccessRuleController.create(c));
applicationAccessRuleRouter.patch("/:id", (c) => ApplicationAccessRuleController.update(c));
applicationAccessRuleRouter.delete("/:id", (c) => ApplicationAccessRuleController.remove(c));

export const applicationAccessRouter = new Hono<{ Variables: AdminVariables }>();

applicationAccessRouter.get("/applications", (c) => ApplicationAccessController.applications(c));
applicationAccessRouter.post("/applications", (c) => ApplicationAccessController.createApplication(c));
applicationAccessRouter.get("/apps/:applicationId/exceptions", (c) => ApplicationAccessController.exceptions(c));
applicationAccessRouter.get("/scope-catalog", (c) => ApplicationAccessController.scopeCatalog(c));
applicationAccessRouter.get("/apps/:applicationId/role-options", (c) => ApplicationAccessController.roleOptions(c));
applicationAccessRouter.get("/apps/:applicationId/details", (c) => ApplicationAccessController.getApplication(c));
applicationAccessRouter.patch("/apps/:applicationId/details", (c) => ApplicationAccessController.updateApplication(c));
applicationAccessRouter.patch("/apps/:applicationId/connection-scopes", (c) => ApplicationAccessController.updateConnectionScopes(c));
applicationAccessRouter.get("/apps/:applicationId/removal", (c) => ApplicationAccessController.removal(c));
applicationAccessRouter.delete("/apps/:applicationId", (c) => ApplicationAccessController.removeApplication(c));
applicationAccessRouter.get("/apps/:applicationId/setup", (c) => ApplicationAccessController.setup(c));
applicationAccessRouter.post("/apps/:applicationId/connect", (c) => ApplicationAccessController.connect(c));
applicationAccessRouter.post("/apps/:applicationId/publish", (c) => ApplicationAccessController.publish(c));
applicationAccessRouter.post("/apps/:applicationId/unpublish", (c) => ApplicationAccessController.unpublish(c));
applicationAccessRouter.get("/apps/:applicationId", (c) => ApplicationAccessController.application(c));
applicationAccessRouter.get("/candidates", (c) => ApplicationAccessController.candidates(c));
applicationAccessRouter.get("/", (c) => ApplicationAccessController.list(c));

export const applicationOrganizationRouter = new Hono<{ Variables: AdminVariables }>();

applicationOrganizationRouter.get("/", (c) => ApplicationOrganizationController.list(c));

export const applicationPermissionRouter = new Hono<{ Variables: AdminVariables }>();

applicationPermissionRouter.get("/", (c) => ApplicationPermissionController.list(c));
applicationPermissionRouter.post("/", (c) => ApplicationPermissionController.create(c));
