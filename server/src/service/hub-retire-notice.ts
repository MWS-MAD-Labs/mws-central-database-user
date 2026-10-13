import { hubApplicationId } from "../constants/hub-application";
import { prismaClient } from "../lib/prisma";
import { decryptSecret } from "../utils/secret-box";

const TIMEOUT_MS = 5000;

// Tells the Hub that an application was retired, so the Hub has its backend end the sessions it still holds.
// Best effort: the application also ends them itself the next time it asks Central. Returns whether the Hub took it.
export async function notifyHubAppRetired(applicationId: string): Promise<boolean> {
  try {
    const [hub, app] = await Promise.all([
      prismaClient.application.findUnique({
        where: { application_id: hubApplicationId() },
        select: { hub_base_url: true, hub_internal_secret: true },
      }),
      prismaClient.application.findUnique({
        where: { application_id: applicationId },
        select: { logout_url: true, uses_hub: true, hub_secret_mode: true, hub_secret_version: true },
      }),
    ]);
    if (!hub?.hub_base_url || !hub.hub_internal_secret || !app?.logout_url || !app.uses_hub) return false;
    const response = await fetch(new URL("/sso/app-retired", hub.hub_base_url), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "x-hub-internal-secret": decryptSecret(hub.hub_internal_secret) },
      body: JSON.stringify({
        application_id: applicationId,
        logout_url: app.logout_url,
        secret_mode: app.hub_secret_mode,
        secret_version: app.hub_secret_version,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
