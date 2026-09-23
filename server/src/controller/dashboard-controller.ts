import type { Context } from "hono";
import { DashboardService } from "../service/dashboard-service";
import type { DashboardVariables } from "../type/hono-context";

export class DashboardController {
  static async summary(c: Context<{ Variables: DashboardVariables }>) {
    const response = await DashboardService.summary(c.var.dashboardUser);
    return c.json({ data: response });
  }
}
