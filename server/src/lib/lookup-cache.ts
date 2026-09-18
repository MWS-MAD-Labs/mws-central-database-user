import { redis } from "./redis";
// Cache stable lookup hits for five minutes.
const TTL_SECONDS = 300;

export type LookupCacheResult<T> = { value: T; cached: boolean };

export async function withLookupCache<T>(
  namespace: string,
  keyParts: (string | null | undefined)[],
  fetcher: () => Promise<T>,
  options: { skipCache?: boolean } = {},
): Promise<LookupCacheResult<T>> {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true" ||
    options.skipCache
  ) {
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

  // Do not cache misses; new or reactivated people must appear immediately.
  if (value !== null) {
    try {
      await redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
    } catch {}
  }

  return { value, cached: false };
}
