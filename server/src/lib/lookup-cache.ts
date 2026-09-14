import { redis } from "./redis";
// A student/employee's existence and status don't change minute to minute,
// so a few minutes of staleness here is fine - long enough that a client
// polling every few seconds (e.g. multiple apps sharing one API client key,
// each re-checking the same person on every page nav) mostly hits cache
// instead of re-querying Postgres and re-writing an audit log row per hit.
const TTL_SECONDS = 300;

export type LookupCacheResult<T> = { value: T; cached: boolean };

export async function withLookupCache<T>(
  namespace: string,
  keyParts: (string | null | undefined)[],
  fetcher: () => Promise<T>,
): Promise<LookupCacheResult<T>> {
  if (process.env.NODE_ENV === "test" || process.env.CI === "true") {
    return { value: await fetcher(), cached: false };
  }

  const key = `lookup_cache:${namespace}:${keyParts.map((part) => part ?? "").join(":")}`;

  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return { value: JSON.parse(cached) as T, cached: true };
    }
  } catch {}

  const value = await fetcher();

  // Not-found (null) is never cached - both current callers (employee/
  // student lookup) use null as their "no match" sentinel, and caching a
  // negative result for a full TTL window means a person created (or just
  // activated) during that window stays invisible to every caller sharing
  // this cache key, with no way to tell from the outside that the answer
  // is stale rather than genuinely absent. A real match is comparatively
  // stable (see TTL_SECONDS above) and safe to cache; "not found right
  // now" is not the same guarantee.
  if (value !== null) {
    try {
      await redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
    } catch {}
  }

  return { value, cached: false };
}
