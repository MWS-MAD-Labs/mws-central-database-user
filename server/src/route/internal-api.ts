import { Hono } from "hono";
import { apiAuthMiddleware } from "../middleware/api-auth-middleware";
import type { ApiClientVariables } from "../type/hono-context";
import { UserLookupController } from "../controller/internal/user-lookup-controller";
import { StudentApiController } from "../controller/internal/student-api-controller";
import { EmployeeApiController } from "../controller/internal/employee-api-controller";

export const internalRouter = new Hono<{ Variables: ApiClientVariables }>();

internalRouter.use("/api/*", apiAuthMiddleware);

// // User lookup (after Google Sign-In)
// internalRouter.get("/api/v1/users/lookup", (c) => UserLookupController.lookup(c));

// // Students
// internalRouter.get("/api/v1/students", (c) => StudentApiController.list(c));
// internalRouter.get("/api/v1/students/:nis", (c) => StudentApiController.getByNis(c));

// // Employees
// internalRouter.get("/api/v1/employees", (c) => EmployeeApiController.list(c));
// internalRouter.get("/api/v1/employees/:employeeId", (c) => EmployeeApiController.getByEmployeeId(c));
