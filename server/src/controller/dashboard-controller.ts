import type { Context } from "hono";
import { DashboardService } from "../service/dashboard-service";
import type { DashboardVariables } from "../type/hono-context";

export class DashboardController {
  static async summary(c: Context<{ Variables: DashboardVariables }>) {
    void c.var.dashboardUser;

    const response = await DashboardService.summary();
    return c.json({ data: response });
  }
}
