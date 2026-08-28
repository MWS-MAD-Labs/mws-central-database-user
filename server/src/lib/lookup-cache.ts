import { redis } from "./redis";
const TTL_SECONDS = 10;

export async function withLookupCache<T>(
  namespace: string,
  keyParts: (string | null | undefined)[],
  fetcher: () => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV === "test" || process.env.CI === "true") {
    return fetcher();
  }

  const key = `lookup_cache:${namespace}:${keyParts.map((part) => part ?? "").join(":")}`;

  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch {}

  const value = await fetcher();

  try {
    await redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
  } catch {}

  return value;
}
