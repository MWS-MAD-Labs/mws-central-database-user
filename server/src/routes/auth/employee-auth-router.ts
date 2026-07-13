import { Hono } from "hono";
import { AuthController } from "../../controller/admin/auth-controller";
import { employeeAuthMiddleware } from "../../middleware/employee-auth-middleware";
import type { EmployeeVariables } from "../../type/hono-context";

export const employeeAuthRouter = new Hono<{ Variables: EmployeeVariables }>();

employeeAuthRouter.get("/me", employeeAuthMiddleware, (c) =>
  AuthController.employeeMe(c),
);
employeeAuthRouter.post("/logout", employeeAuthMiddleware, (c) =>
  AuthController.employeeLogout(c),
);
