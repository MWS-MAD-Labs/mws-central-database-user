import { redis } from "./redis";

// Cache filtered totals briefly to avoid repeated COUNT(*) scans.
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
