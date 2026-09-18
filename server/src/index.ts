import { web } from "./application/web";
import { logger } from "./lib/logger";
import { EmployeeService } from "./service/employee-service";
import { DisciplinaryActionService } from "./service/disciplinary-action-service";
import { syncApiScopes } from "./lib/sync-api-scopes";

const AUTO_RESIGN_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DISCIPLINARY_ACTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

declare global {
  // eslint-disable-next-line no-var
  var __autoResignSweepInterval: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __disciplinaryActionSweepInterval:
    | ReturnType<typeof setInterval>
    | undefined;
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

async function runDisciplinaryActionSweep(): Promise<void> {
  try {
    const count = await DisciplinaryActionService.expirePastDueActions();
    if (count > 0) {
      logger.info(
        `Disciplinary action sweep: ${count} record(s) flipped to EXPIRED.`,
      );
    }
  } catch (error) {
    logger.error("Disciplinary action sweep failed", error);
  }
}

// Clear intervals left by hot reloads.
if (globalThis.__autoResignSweepInterval) {
  clearInterval(globalThis.__autoResignSweepInterval);
}
void runAutoResignSweep();
globalThis.__autoResignSweepInterval = setInterval(
  runAutoResignSweep,
  AUTO_RESIGN_SWEEP_INTERVAL_MS,
);

if (globalThis.__disciplinaryActionSweepInterval) {
  clearInterval(globalThis.__disciplinaryActionSweepInterval);
}
void runDisciplinaryActionSweep();
globalThis.__disciplinaryActionSweepInterval = setInterval(
  runDisciplinaryActionSweep,
  DISCIPLINARY_ACTION_SWEEP_INTERVAL_MS,
);

// Keep persisted API scopes in sync on boot.
syncApiScopes()
  .then(() => logger.info("API scope catalog synced"))
  .catch((error) => logger.error("API scope catalog sync failed", error));

web.get("/", (c) => {
  return c.text("Halo, School Center is Running");
});

export default {
  port: 3000,
  fetch: web.fetch,
  // Bulk imports can exceed the adapter's default timeout.
  idleTimeout: 120,
};
