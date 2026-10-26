import { hubApplicationId } from "../constants/hub-application";
import { ApplicationLaunchMode, ApplicationSessionMode } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { logger } from "../lib/logger";
import { decryptSecret } from "../utils/secret-box";
import { checkApplicationAddress, checkExchangeSeen } from "./hub-address-check";

export type ApplicationHealthStatus = "healthy" | "pending" | "check_token" | "token_pending" | "sign_in_pending" | "unreachable" | "wrong_path";
export type ApplicationHealth = { status: ApplicationHealthStatus; detail: string | null; since: string | null };

export type HealthCredential = {
  status: string;
  issued_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  last_rejected_at: Date | null;
};

// Two failed checks in a row mark an address down, one answer clears it.
export const FAILURES_TO_MARK_DOWN = 2;
const CHECK_EVERY_MS = 5 * 60 * 1000;

function usable(credential: HealthCredential, now: Date): boolean {
  return (
    (credential.status === "ACTIVE" || credential.status === "RETIRING") &&
    !credential.revoked_at &&
    (!credential.expires_at || credential.expires_at > now)
  );
}

// A sign-in way change nobody has proved yet is shown for a week, then it is left alone so a quiet app is not marked forever.
const SIGN_IN_PENDING_DAYS = 7;

// What Central can tell about an application after setup: whether its address answers, and whether something still
// calls with a token that no longer works. Not connected yet is its own state, the setup steps cover it.
export function healthOf(input: {
  connected: boolean;
  credentials: HealthCredential[];
  addressStatus: string | null;
  addressDownSince: Date | null;
  // When the sign-in way last changed, and the first proof of the new way after that.
  signIn?: { changedAt: Date | null; confirmedAt: Date | null };
  now?: Date;
}): ApplicationHealth {
  const now = input.now ?? new Date();
  if (input.addressStatus === "wrong_path") {
    return { status: "wrong_path", detail: "The sign-in address answers Not Found", since: input.addressDownSince ? input.addressDownSince.toISOString() : null };
  }
  if (input.addressStatus === "unreachable") {
    return { status: "unreachable", detail: "Not answering at its address", since: input.addressDownSince ? input.addressDownSince.toISOString() : null };
  }
  const current = input.credentials.filter((credential) => usable(credential, now));
  const lastUsed = current.map((credential) => credential.last_used_at).filter((date): date is Date => Boolean(date)).sort((a, b) => b.getTime() - a.getTime())[0];
  const rejected = input.credentials
    .filter((credential) => !usable(credential, now))
    .map((credential) => credential.last_rejected_at)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (rejected && (!lastUsed || rejected > lastUsed)) {
    return { status: "check_token", detail: "Still calling with an old token", since: rejected.toISOString() };
  }
  if (!input.connected) return { status: "pending", detail: null, since: null };

  // The newest token has never been used after a rotation: the app is still on the old one, or on none.
  const newest = [...input.credentials].filter((credential) => usable(credential, now)).sort((a, b) => b.issued_at.getTime() - a.issued_at.getTime())[0];
  if (newest && input.credentials.length > 1 && !newest.last_used_at) {
    const retiring = input.credentials.filter((credential) => credential.status === "RETIRING" && usable(credential, now) && credential !== newest);
    const until = retiring.map((credential) => credential.expires_at).filter((date): date is Date => Boolean(date)).sort((a, b) => b.getTime() - a.getTime())[0];
    return until
      ? { status: "token_pending", detail: "Waiting for the app to use the new token. The old one works until", since: until.toISOString() }
      : { status: "token_pending", detail: "The old token has stopped. The app needs the new token now", since: newest.issued_at.toISOString() };
  }

  const changedAt = input.signIn?.changedAt;
  if (changedAt && !input.signIn?.confirmedAt && now.getTime() - changedAt.getTime() < SIGN_IN_PENDING_DAYS * 24 * 60 * 60 * 1000) {
    return { status: "sign_in_pending", detail: "Waiting for the app to sign someone in the new way", since: changedAt.toISOString() };
  }
  return { status: "healthy", detail: null, since: null };
}

type SignInApplication = {
  id: string;
  application_id: string;
  session_mode: ApplicationSessionMode;
  session_mode_changed_at: Date | null;
  session_mode_confirmed_at: Date | null;
};

// Looks for the first proof that an application signs in the way it was switched to, and keeps it once found.
// Shared: the application asked Central about a person with its own token, which code-and-token code never does.
// Code and token: the Hub traded a code for it. `known` is false when the Hub could not be asked.
let askHub: typeof checkExchangeSeen = checkExchangeSeen;

// Tests answer for the Hub instead of calling it.
export function useExchangeSeenForTest(replacement: typeof checkExchangeSeen | null) {
  askHub = replacement ?? checkExchangeSeen;
}

export async function confirmSignIn(
  app: SignInApplication,
  exchangeSeen: typeof checkExchangeSeen = askHub,
): Promise<{ confirmedAt: Date | null; known: boolean }> {
  if (app.session_mode_confirmed_at) return { confirmedAt: app.session_mode_confirmed_at, known: true };
  const since = app.session_mode_changed_at;
  if (!since) return { confirmedAt: null, known: true };

  let confirmedAt: Date | null = null;
  let known = true;
  if (app.session_mode === ApplicationSessionMode.SHARED) {
    const clients = await prismaClient.apiClient.findMany({ where: { profile: { code: app.application_id } }, select: { id: true } });
    const seen = clients.length
      ? await prismaClient.auditLog.findFirst({
          where: {
            entity_type: "ApplicationEntitlement",
            action: "API_ACCESS",
            api_client_id: { in: clients.map((client) => client.id) },
            created_at: { gt: since },
            new_values: { path: ["requested_application_id"], equals: app.application_id },
          },
          orderBy: { created_at: "asc" },
          select: { created_at: true },
        })
      : null;
    confirmedAt = seen?.created_at ?? null;
  } else {
    const hub = await prismaClient.application.findUnique({
      where: { application_id: hubApplicationId() },
      select: { hub_base_url: true, hub_internal_secret: true },
    });
    if (!hub?.hub_base_url || !hub.hub_internal_secret) return { confirmedAt: null, known: false };
    const answer = await exchangeSeen(hub.hub_base_url, decryptSecret(hub.hub_internal_secret), app.application_id);
    known = answer.known;
    confirmedAt = answer.seenAt && answer.seenAt > since ? answer.seenAt : null;
  }
  if (confirmedAt) {
    await prismaClient.application.update({ where: { id: app.id }, data: { session_mode_confirmed_at: confirmedAt } });
  }
  return { confirmedAt, known };
}

// The sign-in changes still waiting for proof, looked at without anybody having the page open.
async function confirmPendingSignIns(): Promise<void> {
  const pending = await prismaClient.application.findMany({
    where: {
      retired_at: null,
      launch_mode: ApplicationLaunchMode.SSO,
      session_mode_changed_at: { gt: new Date(Date.now() - SIGN_IN_PENDING_DAYS * 24 * 60 * 60 * 1000) },
      session_mode_confirmed_at: null,
    },
    select: { id: true, application_id: true, session_mode: true, session_mode_changed_at: true, session_mode_confirmed_at: true },
  });
  for (const app of pending) await confirmSignIn(app).catch(() => undefined);
}

type CheckedApplication = {
  id: string;
  launch_url: string | null;
  address_failures: number;
  address_status: string | null;
  address_down_since: Date | null;
};

const CHECK_SELECT = { id: true, launch_url: true, address_failures: true, address_status: true, address_down_since: true } as const;

// Asks the address of one application and keeps the answer. A wrong path is a firm answer and is kept at once. An
// address nothing answers at waits for a second miss, unless `immediate` says somebody is looking at it right now.
export async function checkOneApplication(
  application: CheckedApplication,
  options: { check?: (address: string) => Promise<string>; now?: Date; immediate?: boolean } = {},
): Promise<string> {
  const { check = checkApplicationAddress, now = new Date(), immediate = false } = options;
  if (!application.launch_url) return "refused";
  const verdict = await check(application.launch_url).catch(() => "unreachable");
  if (verdict === "refused") return verdict;
  const wrongPath = verdict === "wrong_path";
  const down = verdict === "unreachable";
  const failures = down ? application.address_failures + 1 : 0;
  const markedDown = down && (immediate || failures >= FAILURES_TO_MARK_DOWN);
  const bad = wrongPath || markedDown;
  await prismaClient.application.update({
    where: { id: application.id },
    data: {
      address_checked_at: now,
      address_failures: failures,
      address_status: wrongPath ? "wrong_path" : markedDown ? "unreachable" : down ? application.address_status : "ok",
      address_down_since: bad ? (application.address_down_since ?? now) : down ? application.address_down_since : null,
    },
  });
  return verdict;
}

// One pass over the applications that have an address: the result of each check is kept on the application.
export async function checkApplicationAddresses(
  check: (address: string) => Promise<string> = checkApplicationAddress,
  now: Date = new Date(),
): Promise<void> {
  await confirmPendingSignIns();
  const applications = await prismaClient.application.findMany({
    where: { retired_at: null, launch_mode: ApplicationLaunchMode.SSO, launch_url: { not: null } },
    select: CHECK_SELECT,
  });
  for (const application of applications) await checkOneApplication(application, { check, now });
}

declare global {
  // eslint-disable-next-line no-var
  var __applicationHealthInterval: ReturnType<typeof setInterval> | undefined;
}

export function startApplicationHealthChecks() {
  // Clear an interval left by a hot reload.
  if (globalThis.__applicationHealthInterval) clearInterval(globalThis.__applicationHealthInterval);
  globalThis.__applicationHealthInterval = setInterval(() => {
    checkApplicationAddresses().catch((error) => logger.error("Application address check failed", error));
  }, CHECK_EVERY_MS);
}
