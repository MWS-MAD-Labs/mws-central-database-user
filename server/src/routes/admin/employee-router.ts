import { Hono } from "hono";
import { EmployeeController } from "../../controller/admin/employee-controller";
import type { AdminVariables } from "../../type/hono-context";

export const employeeRouter = new Hono<{ Variables: AdminVariables }>();

employeeRouter.post("/", (c) => EmployeeController.create(c));
employeeRouter.patch("/:id", (c) => EmployeeController.update(c));
employeeRouter.get("/:id", (c) => EmployeeController.get(c));
