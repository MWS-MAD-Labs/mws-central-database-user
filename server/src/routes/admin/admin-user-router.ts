import { Hono } from "hono";
import { AdminUserController } from "../../controller/admin/admin-user-controller";
import type { AdminVariables } from "../../type/hono-context";

export const adminUserRouter = new Hono<{ Variables: AdminVariables }>();

adminUserRouter.post("/promote", (c) => AdminUserController.promote(c));
adminUserRouter.patch("/demote/:id", (c) => AdminUserController.demote(c));
adminUserRouter.patch("/can-write-data/:id", (c) =>
  AdminUserController.setCanWriteData(c),
);
adminUserRouter.patch("/grant-after-hours/:id", (c) =>
  AdminUserController.grantAfterHoursWrite(c),
);
