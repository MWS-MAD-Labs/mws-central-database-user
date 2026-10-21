import { Hono } from "hono";
import { ChildrenAllowanceController } from "../../controller/admin/children-allowance-controller";
import type { AdminVariables } from "../../type/hono-context";

// Rules about employees that a Super Admin can change, kept out of the code.
export const employeeSettingsRouter = new Hono<{ Variables: AdminVariables }>();

employeeSettingsRouter.get("/children-allowance", (c) => ChildrenAllowanceController.get(c));
employeeSettingsRouter.put("/children-allowance", (c) => ChildrenAllowanceController.update(c));
