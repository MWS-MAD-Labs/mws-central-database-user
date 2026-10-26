// Asks an address whether a Hub answers there, before the address goes into the .env of every application. The Hub
// publishes its sign-in keys at /.well-known/jwks.json, so a JSON answer with `keys` is what tells it apart from
// any other server. A Hub that is running but has no signing key answers that path with an error, so its /health
// is asked next: that tells "this is the Hub, it has no key yet" from "this is not the Hub". Only the verdict
// leaves here, never what the address said.
import { accessCookieNameProblem } from "../utils/application-env";
import { thumbprintOf } from "../utils/hub-signing-key";

export type HubAddressVerdict = "ok" | "unreachable" | "not_hub" | "no_keys" | "refused";

const TIMEOUT_MS = 4000;
const SECRET_PATH = "/sso/secret-check";
const MAX_BYTES = 64 * 1024;

// Addresses that must never be asked from the server: link-local ones, where cloud metadata lives.
function refusedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.startsWith("169.254.") || host === "metadata.google.internal" || host === "[fd00:ec2::254]";
}

// The Hub answers /health with { data: "ok" }, and its nginx front with plain "ok". Nothing else is read from it.
async function answersLikeHub(url: URL): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", url.origin), {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) return false;
    const text = (await response.text()).slice(0, MAX_BYTES).trim();
    if (text === "ok") return true;
    const body = JSON.parse(text) as { data?: unknown };
    return body.data === "ok";
  } catch {
    return false;
  }
}

// The cookie name the running Hub says it uses (/.well-known/hub-config), or null for a Hub that does not report it
// yet or does not answer well. Only the name leaves here, and only if it is a safe one.
async function readHubCookieName(url: URL): Promise<string | null> {
  try {
    const response = await fetch(new URL("/.well-known/hub-config", url.origin), {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) return null;
    const text = (await response.text()).slice(0, MAX_BYTES);
    const name = (JSON.parse(text) as { access_cookie_name?: unknown }).access_cookie_name;
    return typeof name === "string" && accessCookieNameProblem(name) === null ? name : null;
  } catch {
    return null;
  }
}

export type HubAddressResult = { verdict: HubAddressVerdict; thumbprints: string[]; cookieName: string | null };

// The verdict, and the thumbprints of the public keys the Hub publishes, so a caller can tell whether it is the key
// Central made. Only the thumbprints leave here, never the keys.
export async function checkHubAddressDetailed(address: string): Promise<HubAddressResult> {
  const result = (verdict: HubAddressVerdict, thumbprints: string[] = [], cookieName: string | null = null): HubAddressResult => ({
    verdict,
    thumbprints,
    cookieName,
  });
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return result("refused");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || refusedHost(url.hostname)) {
    return result("refused");
  }
  try {
    const response = await fetch(new URL("/.well-known/jwks.json", url.origin), {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) return result((await answersLikeHub(url)) ? "no_keys" : "not_hub");
    const reader = response.body?.getReader();
    if (!reader) return result("not_hub");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return result("not_hub");
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { keys?: unknown };
    if (!Array.isArray(body.keys)) return result("not_hub");
    const thumbprints = body.keys.flatMap((key) => {
      const print = key && typeof key === "object" ? thumbprintOf(key as Record<string, unknown>) : null;
      return print ? [print] : [];
    });
    return result("ok", thumbprints, await readHubCookieName(url));
  } catch (error) {
    // Nothing answered, or it timed out. A parse error means something answered with no JSON, so it is not a Hub.
    return result(error instanceof SyntaxError ? "not_hub" : "unreachable");
  }
}

export async function checkHubAddress(address: string): Promise<HubAddressVerdict> {
  return (await checkHubAddressDetailed(address)).verdict;
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

// "unverifiable" is a server that answers every path with a page, so a wrong path cannot be told from a right one.
export type ApplicationAddressVerdict = "ok" | "unreachable" | "wrong_path" | "unverifiable" | "refused";

// Where an application usually keeps its sign-in entry.
const ENTRY_PATHS = ["/auth/sso", "/api/v1/auth/sso", "/api/auth/sso", "/sso"];

export type ApplicationAddressResult = { verdict: ApplicationAddressVerdict; suggestion: string | null };

// A server that answers every path with a page: another path of it that answers with a redirect is likely the entry.
async function findEntry(url: URL): Promise<string | null> {
  for (const path of ENTRY_PATHS) {
    if (path === url.pathname) continue;
    try {
      const response = await fetch(new URL(path, url.origin), { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      await response.body?.cancel();
      if (response.status >= 300 && response.status < 400) return new URL(path, url.origin).toString();
    } catch {
      // The next one is tried.
    }
  }
  return null;
}

// Whether the sign-in address of an application answers. The address is asked as saved, path included. A 404 means
// something is running there but not at that path. A redirect to the sign-in page is still an application that is up.
// A proxy with nothing behind it (502 to 504) is not. A server that answers every path with a page says "unverifiable",
// with the path that looks like its sign-in entry when there is one.
export async function checkApplicationAddressDetailed(address: string): Promise<ApplicationAddressResult> {
  const result = (verdict: ApplicationAddressVerdict, suggestion: string | null = null): ApplicationAddressResult => ({ verdict, suggestion });
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return result("refused");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || refusedHost(url.hostname)) {
    return result("refused");
  }
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 500) {
      await response.body?.cancel();
      return result("unreachable");
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return result("wrong_path");
    }
    const isPage = response.status === 200 && (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
    await response.body?.cancel();
    if (!isPage) return result("ok");
    // A page may be the real sign-in page or a catch-all. A path that cannot exist tells which.
    const stray = await fetch(new URL(`/central-check-${crypto.randomUUID()}`, url.origin), { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await stray.body?.cancel();
    const answersEverything = stray.status === 200 && (stray.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
    return answersEverything ? result("unverifiable", await findEntry(url)) : result("ok");
  } catch {
    return result("unreachable");
  }
}

export async function checkApplicationAddress(address: string): Promise<ApplicationAddressVerdict> {
  return (await checkApplicationAddressDetailed(address)).verdict;
}

// When the Hub last traded a sign-in code for this application, asked with the master secret. `known` is false when
// the Hub could not be asked or does not have the question yet, so the caller does not treat that as "never".
export async function checkExchangeSeen(address: string, secret: string, applicationId: string): Promise<{ known: boolean; seenAt: Date | null }> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { known: false, seenAt: null };
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || refusedHost(url.hostname)) {
    return { known: false, seenAt: null };
  }
  try {
    const response = await fetch(new URL("/sso/exchange-seen", url.origin), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json", "Content-Type": "application/json", "x-hub-internal-secret": secret },
      body: JSON.stringify({ application_id: applicationId }),
    });
    if (response.status !== 200) return { known: false, seenAt: null };
    const body = (await response.json()) as { data?: { seen_at?: string | null } };
    const seen = body.data?.seen_at ? new Date(body.data.seen_at) : null;
    return { known: true, seenAt: seen && !Number.isNaN(seen.getTime()) ? seen : null };
  } catch {
    return { known: false, seenAt: null };
  }
}
