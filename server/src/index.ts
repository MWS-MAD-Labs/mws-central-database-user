import { web } from "./application/web";
import { logger } from "./lib/logger";
import { EmployeeService } from "./service/employee-service";

const AUTO_RESIGN_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

declare global {
  // eslint-disable-next-line no-var
  var __autoResignSweepInterval: ReturnType<typeof setInterval> | undefined;
}

async function runAutoResignSweep(): Promise<void> {
  try {
    const count = await EmployeeService.autoResignPastDueEmployees();
    if (count > 0) {
      logger.info(
        `Auto-resign sweep: ${count} employee(s) flipped to RESIGNED.`,
      );
    }
  } catch (error) {
    logger.error("Auto-resign sweep failed", error);
  }
}

// `bun run --hot` re-evaluates this module on file changes - clear any
// interval from a previous load so they don't stack up. Production runs
// without --hot, so this guard never actually triggers there.
if (globalThis.__autoResignSweepInterval) {
  clearInterval(globalThis.__autoResignSweepInterval);
}
void runAutoResignSweep();
globalThis.__autoResignSweepInterval = setInterval(
  runAutoResignSweep,
  AUTO_RESIGN_SWEEP_INTERVAL_MS,
);

web.get("/", (c) => {
  return c.text("Halo, School Center is Running");
});

export default {
  port: 3000,
  fetch: web.fetch,
  // Default is 10s - bulk import commit processes rows sequentially and
  // can take well over that for a few hundred rows.
  idleTimeout: 120,
};
