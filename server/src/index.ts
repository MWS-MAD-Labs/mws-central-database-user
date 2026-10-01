import { web } from "./application/web";
import { logger } from "./lib/logger";
import { EmployeeService } from "./service/employee-service";
import { DisciplinaryActionService } from "./service/disciplinary-action-service";
import { PCActivityRoomService } from "./service/pc-activity-room-service";
import { syncApiScopes } from "./lib/sync-api-scopes";
import { validateChangeRequestApproverConfig } from "./utils/change-request-approver";

const AUTO_RESIGN_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DISCIPLINARY_ACTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PC_ACTIVITY_ROOM_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

declare global {
  // eslint-disable-next-line no-var
  var __autoResignSweepInterval: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __disciplinaryActionSweepInterval:
    | ReturnType<typeof setInterval>
    | undefined;
  // eslint-disable-next-line no-var
  var __pcActivityRoomSweepInterval: ReturnType<typeof setInterval> | undefined;
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

async function runPcActivityRoomSweep(): Promise<void> {
  try {
    const activatedCount = await PCActivityRoomService.activateScheduledAssignments();
    const expiredCount = await PCActivityRoomService.expirePastDueAssignments();
    if (activatedCount > 0 || expiredCount > 0) {
      logger.info(
        `PC Activity room sweep: ${activatedCount} assignment(s) activated, ${expiredCount} assignment(s) expired.`,
      );
    }
  } catch (error) {
    logger.error("PC Activity room sweep failed", error);
  }
}

// Clear intervals left by hot reloads.
if (globalThis.__autoResignSweepInterval) {
  clearInterval(globalThis.__autoResignSweepInterval);
}
globalThis.__autoResignSweepInterval = setInterval(
  runAutoResignSweep,
  AUTO_RESIGN_SWEEP_INTERVAL_MS,
);

if (globalThis.__disciplinaryActionSweepInterval) {
  clearInterval(globalThis.__disciplinaryActionSweepInterval);
}
globalThis.__disciplinaryActionSweepInterval = setInterval(
  runDisciplinaryActionSweep,
  DISCIPLINARY_ACTION_SWEEP_INTERVAL_MS,
);

if (globalThis.__pcActivityRoomSweepInterval) {
  clearInterval(globalThis.__pcActivityRoomSweepInterval);
}
globalThis.__pcActivityRoomSweepInterval = setInterval(
  runPcActivityRoomSweep,
  PC_ACTIVITY_ROOM_SWEEP_INTERVAL_MS,
);

// The server must not accept traffic with a stale profile/scope catalog.
await syncApiScopes();
logger.info("API scope and integration profile catalog synced");

// First runs of the sweeps and the approver check go one after another, in the
// background. Started together they all hit the single pg connection at once,
// which is what triggers the "client is already executing a query" warning.
void (async () => {
  await runAutoResignSweep();
  await runDisciplinaryActionSweep();
  await runPcActivityRoomSweep();
  // Catch a misconfigured approver setup early instead of letting it fail
  // silently (no one able to approve identifier change requests).
  await validateChangeRequestApproverConfig().catch((error) =>
    logger.error("Change-request approver config validation failed", error),
  );
})();

web.get("/", (c) => {
  return c.text("Halo, School Center is Running");
});

export default {
  port: 3000,
  fetch: web.fetch,
  // Bulk imports can exceed the adapter's default timeout.
  idleTimeout: 120,
};
