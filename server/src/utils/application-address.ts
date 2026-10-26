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

// Another live application that already has exactly this address.
export function addressTakenBy(address: string, others: Addressed[], selfId?: string): Addressed | undefined {
  return others.find((other) => !other.retired_at && other.application_id !== selfId && sameAddress(other.launch_url, address));
}

// Names of the other live applications on the same origin. Allowed, since apps can share a domain by path.
export function originSharedWith(address: string | null, others: Addressed[], selfId: string): string[] {
  return others
    .filter((other) => !other.retired_at && other.application_id !== selfId && sameOrigin(other.launch_url, address))
    .map((other) => other.name);
}
