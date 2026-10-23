import { resolve4, resolve6, resolveMx } from "node:dns/promises";
import { ResponseError } from "../error/response-error";

// Says whether a domain can receive email: it has an MX record, or else an address (the implicit MX of the mail rules).
// "unknown" is for a network that did not answer, which is not a reason to refuse anyone.
export type DomainAnswer = "yes" | "no" | "unknown";
export type DomainResolver = (domain: string) => Promise<DomainAnswer>;

const TIMEOUT_MS = 3000;
const CACHE_MS = 10 * 60 * 1000;

const notFound = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENOTFOUND" || code === "ENODATA" || code === "ENOENT";
};

const withTimeout = <T>(work: Promise<T>): Promise<T> =>
  Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))]);

const dnsResolver: DomainResolver = async (domain) => {
  try {
    const records = await withTimeout(resolveMx(domain));
    if (records.length > 0) return "yes";
  } catch (error) {
    if (!notFound(error)) return "unknown";
  }
  try {
    const [v4, v6] = await withTimeout(Promise.all([resolve4(domain).catch(() => []), resolve6(domain).catch(() => [])]));
    return v4.length + v6.length > 0 ? "yes" : "no";
  } catch {
    return "unknown";
  }
};

let resolver: DomainResolver = dnsResolver;
const cache = new Map<string, { answer: DomainAnswer; at: number }>();

export function setEmailDomainResolverForTests(next: DomainResolver | null): void {
  resolver = next ?? dnsResolver;
  cache.clear();
}

// Refuses an address whose domain certainly cannot receive email, such as a misspelt gmial.com. It does not know if the
// mailbox itself exists. Tests run offline, so they accept every domain unless they bring a resolver.
export async function assertDomainCanReceiveEmail(email: string): Promise<void> {
  if (process.env.NODE_ENV === "test" && resolver === dnsResolver) return;
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return;
  const cached = cache.get(domain);
  let answer = cached && Date.now() - cached.at < CACHE_MS ? cached.answer : null;
  if (!answer) {
    answer = await resolver(domain).catch((): DomainAnswer => "unknown");
    if (answer !== "unknown") cache.set(domain, { answer, at: Date.now() });
  }
  if (answer === "no") {
    throw new ResponseError(400, `The domain ${domain} cannot receive email. Check the spelling of ${email.trim().toLowerCase()}`);
  }
}
