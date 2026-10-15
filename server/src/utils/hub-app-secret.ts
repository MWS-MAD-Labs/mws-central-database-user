import { createHmac } from "crypto";

// The secret of one application, made from the Hub's master secret. Nobody keeps it: Central makes it again for
// the .env, and the Hub makes it again to check it. The version goes into the secret so the Hub can tell an old one
// from the current one after a rotation, and only the master can make a valid one.
export function deriveAppSecret(master: string, applicationId: string, version: number): string {
  const mac = createHmac("sha256", master).update(`app:${applicationId}:${version}`).digest("hex");
  return `v${version}.${mac}`;
}

// The version a presented secret claims, or null when it does not look like one.
export function secretVersion(presented: string): number | null {
  const match = /^v(\d{1,6})\.[0-9a-f]{64}$/.exec(presented);
  return match ? Number(match[1]) : null;
}
