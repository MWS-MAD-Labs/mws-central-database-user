import { IntegrationEnvironment } from "../../generated/prisma/client";
import { getIntegrationEnvironment } from "../../utils/integration-environment";
import type { DirectoryClient } from "./directory-client";
import { readServiceAccountKey, RealDirectoryClient } from "./real-directory-client";
import { SimulatedDirectoryClient } from "./simulated-directory-client";

let cached: DirectoryClient | null = null;
let override: DirectoryClient | null = null;

// Only production, with the switch on and the credentials set, talks to the real Workspace. Staging and development
// share that Workspace, so they get the simulated client.
export function getDirectoryClient(): DirectoryClient {
  if (override) return override;
  if (cached) return cached;

  const live =
    getIntegrationEnvironment() === IntegrationEnvironment.PRODUCTION &&
    process.env.GOOGLE_WORKSPACE_ENABLED === "true";
  if (!live) {
    cached = new SimulatedDirectoryClient();
    return cached;
  }

  const subject = process.env.GOOGLE_WORKSPACE_ADMIN_SUBJECT?.trim();
  if (!subject) throw new Error("GOOGLE_WORKSPACE_ADMIN_SUBJECT is not set");
  cached = new RealDirectoryClient(readServiceAccountKey(process.env.GOOGLE_WORKSPACE_CREDENTIALS_B64), subject);
  return cached;
}

// For tests: a fake in place of both clients. Pass null to go back.
export function setDirectoryClientForTests(client: DirectoryClient | null): void {
  override = client;
}
