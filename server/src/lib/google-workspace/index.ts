import { IntegrationEnvironment } from "../../generated/prisma/client";
import { getIntegrationEnvironment } from "../../utils/integration-environment";
import type { DirectoryClient } from "./directory-client";
import { readServiceAccountKey, RealDirectoryClient } from "./real-directory-client";
import { SimulatedDirectoryClient } from "./simulated-directory-client";

// The start of the address of every account that may be made outside production. Lowercase, or empty.
export const testPrefix = () => (process.env.GOOGLE_WORKSPACE_TEST_PREFIX ?? "").trim().toLowerCase();

let cached: DirectoryClient | null = null;
let override: DirectoryClient | null = null;

// Only production, with the switch on and the credentials set, talks to the real Workspace. Staging and development
// share that Workspace, so they get the simulated client. To try it for real from somewhere else, set
// GOOGLE_WORKSPACE_TEST_PREFIX as well: then only addresses that start with that prefix are sent to Google (see
// assertAllowedTarget), so nothing but test accounts can be touched.
export function getDirectoryClient(): DirectoryClient {
  if (override) return override;
  if (cached) return cached;

  // Tests never talk to Google, whatever the .env of the machine says. They bring a fake with setDirectoryClientForTests.
  if (process.env.NODE_ENV === "test") {
    cached = new SimulatedDirectoryClient();
    return cached;
  }

  const live =
    process.env.GOOGLE_WORKSPACE_ENABLED === "true" &&
    (getIntegrationEnvironment() === IntegrationEnvironment.PRODUCTION || Boolean(testPrefix()));
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
