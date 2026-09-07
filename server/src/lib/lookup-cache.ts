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

  try {
    await redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
  } catch {}

  return { value, cached: false };
}
