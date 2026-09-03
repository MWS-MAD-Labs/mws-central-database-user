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

if (globalThis.__disciplinaryActionSweepInterval) {
  clearInterval(globalThis.__disciplinaryActionSweepInterval);
}
void runDisciplinaryActionSweep();
globalThis.__disciplinaryActionSweepInterval = setInterval(
  runDisciplinaryActionSweep,
  DISCIPLINARY_ACTION_SWEEP_INTERVAL_MS,
);

// A scope added to the API_SCOPES constant is only grantable from the API
// Clients page once it exists in the api_scopes table - sync it on every
// boot instead of requiring a manual `bun run seed:api-scopes` per deploy.
syncApiScopes()
  .then(() => logger.info("API scope catalog synced"))
  .catch((error) => logger.error("API scope catalog sync failed", error));

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
