import { Hono } from "hono";
import { EmployeeController } from "../../controller/admin/employee-controller";
import { ExportController } from "../../controller/admin/export-controller";
import type { AdminVariables } from "../../type/hono-context";

export const employeeRouter = new Hono<{ Variables: AdminVariables }>();

employeeRouter.post("/", (c) => EmployeeController.create(c));
employeeRouter.get("/", EmployeeController.search);
// Must come before /:id - otherwise Hono matches "export" as the :id param.
employeeRouter.get("/export", (c) => ExportController.exportEmployees(c));
employeeRouter.patch("/:id", (c) => EmployeeController.update(c));
employeeRouter.get("/:id", (c) => EmployeeController.get(c));
employeeRouter.patch("/delete/:id", (c) => EmployeeController.remove(c));
employeeRouter.patch("/restore/:id", (c) => EmployeeController.restore(c));
