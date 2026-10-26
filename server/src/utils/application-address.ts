// Compares the sign-in addresses of applications. Scheme and host are case-insensitive, a trailing slash does not count.
type Addressed = { application_id: string; name: string; launch_url: string | null; retired_at: Date | null };

function parse(address: string | null): URL | null {
  if (!address) return null;
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

function pathOf(url: URL): string {
  return url.pathname.replace(/\/+$/, "") + url.search;
}

export function sameAddress(a: string | null, b: string | null): boolean {
  const left = parse(a);
  const right = parse(b);
  return Boolean(left && right && left.origin === right.origin && pathOf(left) === pathOf(right));
}

export function sameOrigin(a: string | null, b: string | null): boolean {
  const left = parse(a);
  const right = parse(b);
  return Boolean(left && right && left.origin === right.origin);
}

// localhost and plain IP addresses: a machine, where one port runs one application and nothing routes by path.
export function isLocalHost(address: string | null): boolean {
  const url = parse(address);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}

// Another live application that cannot share this address: the very same address anywhere, or the same origin on a
// local host. A real domain may be shared by path.
export function addressConflict(address: string, others: Addressed[], selfId?: string): Addressed | undefined {
  return others.find((other) => {
    if (other.retired_at || other.application_id === selfId) return false;
    return sameAddress(other.launch_url, address) || (isLocalHost(address) && sameOrigin(other.launch_url, address));
  });
}

// Names of the other live applications on the same origin. Allowed on a domain, since apps can share one by path.
export function originSharedWith(address: string | null, others: Addressed[], selfId: string): string[] {
  return others
    .filter((other) => !other.retired_at && other.application_id !== selfId && sameOrigin(other.launch_url, address))
    .map((other) => other.name);
}
