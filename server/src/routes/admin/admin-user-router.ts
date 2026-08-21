import { Hono } from "hono";
import { AdminUserController } from "../../controller/admin/admin-user-controller";
import type { AdminVariables } from "../../type/hono-context";

export const adminUserRouter = new Hono<{ Variables: AdminVariables }>();

adminUserRouter.get("/", (c) => AdminUserController.search(c));
adminUserRouter.post("/promote", (c) => AdminUserController.promote(c));
adminUserRouter.patch("/demote/:id", (c) => AdminUserController.demote(c));
adminUserRouter.patch("/can-view-sensitive-data/:id", (c) =>
  AdminUserController.setCanViewSensitiveData(c),
);
adminUserRouter.patch("/can-view-all-units/:id", (c) =>
  AdminUserController.setCanViewAllUnits(c),
);
adminUserRouter.patch("/can-view-employee-pii/:id", (c) =>
  AdminUserController.setCanViewEmployeePii(c),
);
adminUserRouter.patch("/can-write-employee-data/:id", (c) =>
  AdminUserController.setCanWriteEmployeeData(c),
);
adminUserRouter.patch("/can-write-student-data/:id", (c) =>
  AdminUserController.setCanWriteStudentData(c),
);
adminUserRouter.patch("/grant-after-hours/:id", (c) =>
  AdminUserController.grantAfterHoursWrite(c),
);
adminUserRouter.get("/:id", (c) => AdminUserController.get(c));
