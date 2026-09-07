import { redis } from "./redis";

// COUNT(*) over a large, frequently-filtered table is one of Postgres's
// most expensive query shapes - no index makes it O(1), so it re-scans on
// every single page view regardless of which page (unlike skip/take,
// which can at least use an index for the ORDER BY). A pagination bar's
// "total" number being a few seconds stale is invisible to a human, so
// cache it briefly instead of paying that scan on every request.
const TTL_SECONDS = 30;

export async function withCountCache(
  namespace: string,
  cacheKey: string,
  fetcher: () => Promise<number>,
): Promise<number> {
  if (process.env.NODE_ENV === "test" || process.env.CI === "true") {
    return fetcher();
  }

  const key = `count_cache:${namespace}:${cacheKey}`;

  try {
    const cached = await redis.get(key);
    if (cached !== null) return Number(cached);
  } catch {}

  const value = await fetcher();

  try {
    await redis.set(key, String(value), "EX", TTL_SECONDS);
  } catch {}

  return value;
}
