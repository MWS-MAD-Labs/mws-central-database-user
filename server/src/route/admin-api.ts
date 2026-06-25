import { Hono } from "hono";
import { adminAuthMiddleware } from "../middleware/admin-auth-middleware";
import type { AdminVariables } from "../type/hono-context";
import { AuthController } from "../controller/admin/auth-controller";
import { StudentController } from "../controller/admin/student-controller";
import { EmployeeController } from "../controller/admin/employee-controller";
import { AcademicYearController } from "../controller/admin/academic-year-controller";
import { ClassController } from "../controller/admin/class-controller";
import { AdminUserController } from "../controller/admin/admin-user-controller";
import { ApiClientController } from "../controller/admin/api-client-controller";
import { ImportController } from "../controller/admin/import-controller";
import { ExportController } from "../controller/admin/export-controller";

export const adminRouter = new Hono<{ Variables: AdminVariables }>();

adminRouter.use("/admin/*", adminAuthMiddleware);

// // Auth
// adminRouter.post("/admin/auth/logout", (c) => AuthController.logout(c));
// adminRouter.get("/admin/auth/me", (c) => AuthController.me(c));

// // Students
// adminRouter.get("/admin/students", (c) => StudentController.list(c));
// adminRouter.post("/admin/students", (c) => StudentController.create(c));
// adminRouter.get("/admin/students/:id", (c) => StudentController.get(c));
// adminRouter.patch("/admin/students/:id", (c) => StudentController.update(c));
// adminRouter.patch("/admin/students/:id/deactivate", (c) => StudentController.deactivate(c));
// adminRouter.delete("/admin/students/:id", (c) => StudentController.remove(c));

// // Employees
// adminRouter.get("/admin/employees", (c) => EmployeeController.list(c));
// adminRouter.post("/admin/employees", (c) => EmployeeController.create(c));
// adminRouter.get("/admin/employees/:id", (c) => EmployeeController.get(c));
// adminRouter.patch("/admin/employees/:id", (c) => EmployeeController.update(c));
// adminRouter.patch("/admin/employees/:id/deactivate", (c) => EmployeeController.deactivate(c));
// adminRouter.delete("/admin/employees/:id", (c) => EmployeeController.remove(c));

// // Academic Years
// adminRouter.get("/admin/academic-years", (c) => AcademicYearController.list(c));
// adminRouter.post("/admin/academic-years", (c) => AcademicYearController.create(c));
// adminRouter.get("/admin/academic-years/:id", (c) => AcademicYearController.get(c));
// adminRouter.patch("/admin/academic-years/:id", (c) => AcademicYearController.update(c));

// // Classes
// adminRouter.get("/admin/classes", (c) => ClassController.list(c));
// adminRouter.post("/admin/classes", (c) => ClassController.create(c));
// adminRouter.get("/admin/classes/:id", (c) => ClassController.get(c));
// adminRouter.patch("/admin/classes/:id", (c) => ClassController.update(c));

// // Admin Users
// adminRouter.get("/admin/users", (c) => AdminUserController.list(c));
// adminRouter.post("/admin/users", (c) => AdminUserController.create(c));
// adminRouter.patch("/admin/users/:id", (c) => AdminUserController.update(c));
// adminRouter.delete("/admin/users/:id", (c) => AdminUserController.remove(c));

// // API Clients
// adminRouter.get("/admin/api-clients", (c) => ApiClientController.list(c));
// adminRouter.post("/admin/api-clients", (c) => ApiClientController.create(c));
// adminRouter.patch("/admin/api-clients/:id", (c) => ApiClientController.update(c));
// adminRouter.delete("/admin/api-clients/:id", (c) => ApiClientController.remove(c));

// // Import & Export
// adminRouter.post("/admin/import/students", (c) => ImportController.importStudents(c));
// adminRouter.post("/admin/import/employees", (c) => ImportController.importEmployees(c));
// adminRouter.get("/admin/export/students", (c) => ExportController.exportStudents(c));
// adminRouter.get("/admin/export/employees", (c) => ExportController.exportEmployees(c));
