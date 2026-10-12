// Asks an address whether a Hub answers there, before the address goes into the .env of every application. The Hub
// publishes its sign-in keys at /.well-known/jwks.json, so a JSON answer with `keys` is what tells it apart from
// any other server. Only the verdict leaves here, never what the address said.
export type HubAddressVerdict = "ok" | "unreachable" | "not_hub" | "refused";

const TIMEOUT_MS = 4000;
const SECRET_PATH = "/sso/secret-check";
const MAX_BYTES = 64 * 1024;

// Addresses that must never be asked from the server: link-local ones, where cloud metadata lives.
function refusedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.startsWith("169.254.") || host === "metadata.google.internal" || host === "[fd00:ec2::254]";
}

export async function checkHubAddress(address: string): Promise<HubAddressVerdict> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "refused";
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || refusedHost(url.hostname)) {
    return "refused";
  }
  try {
    const response = await fetch(new URL("/.well-known/jwks.json", url.origin), {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) return "not_hub";
    const reader = response.body?.getReader();
    if (!reader) return "not_hub";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return "not_hub";
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { keys?: unknown };
    return Array.isArray(body.keys) ? "ok" : "not_hub";
  } catch (error) {
    // Nothing answered, or it timed out. A parse error means something answered with no JSON, so it is not a Hub.
    return error instanceof SyntaxError ? "not_hub" : "unreachable";
  }
}

// "no_check" is a Hub that has not been updated with the secret check yet.
export type HubSecretVerdict = "ok" | "wrong" | "unreachable" | "no_check" | "refused";

// Asks the Hub whether this is its master secret. The secret goes in a header to that address only, and nothing
// the Hub says comes back except the verdict.
export async function checkHubSecret(address: string, secret: string): Promise<HubSecretVerdict> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "refused";
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || refusedHost(url.hostname)) {
    return "refused";
  }
  try {
    const response = await fetch(new URL(SECRET_PATH, url.origin), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json", "x-hub-internal-secret": secret },
    });
    if (response.status === 200) return "ok";
    if (response.status === 401) return "wrong";
    if (response.status === 404) return "no_check";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}
