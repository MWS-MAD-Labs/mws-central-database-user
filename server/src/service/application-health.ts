import { ApplicationLaunchMode } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";
import { logger } from "../lib/logger";
import { checkApplicationAddress } from "./hub-address-check";

export type ApplicationHealthStatus = "healthy" | "pending" | "check_token" | "unreachable";
export type ApplicationHealth = { status: ApplicationHealthStatus; detail: string | null; since: string | null };

export type HealthCredential = {
  status: string;
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

// What Central can tell about an application after setup: whether its address answers, and whether something still
// calls with a token that no longer works. Not connected yet is its own state, the setup steps cover it.
export function healthOf(input: {
  connected: boolean;
  credentials: HealthCredential[];
  addressStatus: string | null;
  addressDownSince: Date | null;
  now?: Date;
}): ApplicationHealth {
  const now = input.now ?? new Date();
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
  return { status: "healthy", detail: null, since: null };
}

// One pass over the applications that have an address: the result of each check is kept on the application.
export async function checkApplicationAddresses(
  check: (address: string) => Promise<string> = checkApplicationAddress,
  now: Date = new Date(),
): Promise<void> {
  const applications = await prismaClient.application.findMany({
    where: { retired_at: null, launch_mode: ApplicationLaunchMode.SSO, launch_url: { not: null } },
    select: { id: true, launch_url: true, address_failures: true, address_status: true, address_down_since: true },
  });
  for (const application of applications) {
    const verdict = await check(application.launch_url as string).catch(() => "unreachable");
    if (verdict === "refused") continue;
    const down = verdict === "unreachable";
    const failures = down ? application.address_failures + 1 : 0;
    const markedDown = down && failures >= FAILURES_TO_MARK_DOWN;
    await prismaClient.application.update({
      where: { id: application.id },
      data: {
        address_checked_at: now,
        address_failures: failures,
        address_status: markedDown ? "unreachable" : down ? application.address_status : "ok",
        address_down_since: markedDown ? (application.address_down_since ?? now) : down ? application.address_down_since : null,
      },
    });
  }
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
