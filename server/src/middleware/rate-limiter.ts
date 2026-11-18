import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { redis } from "../lib/redis";
import type { Context, Next } from "hono";
import { getConnInfo } from "hono/bun";
import { routePath } from "hono/route";

// A number from the environment, or the default when it is missing or not a positive whole number.
function pointsFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const authRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  points: 5,
  duration: 15 * 60,
  keyPrefix: "ratelimit_auth",
});

const writeRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  points: 40,
  duration: 60,
  keyPrefix: "ratelimit_write",
});

const readRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  points: 300,
  duration: 3 * 60,
  keyPrefix: "ratelimit_read",
});

// One bucket per API client. The Hub's token serves every person who signs in, so it needs room for a morning rush.
const internalRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  points: pointsFromEnv("INTERNAL_RATE_LIMIT_POINTS", 1200),
  duration: 60,
  keyPrefix: "ratelimit_internal",
});

// Before the token is checked, per caller address: what a caller without a valid token can spend. It is larger than the
// bucket above so the address of a real application never runs out first.
const internalPreAuthRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  points: pointsFromEnv("INTERNAL_PRE_AUTH_RATE_LIMIT_POINTS", 3000),
  duration: 60,
  keyPrefix: "ratelimit_internal_pre_auth",
});

function getClientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (process.env.TRUST_PROXY === "true" && forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address || "unknown_ip";
  } catch {
    return "unknown_ip";
  }
}

const createLimiterMiddleware = (
  limiter: RateLimiterRedis,
  identity: (c: Context) => string = getClientIp,
) => {
  return async (c: Context, next: Next) => {
    if (process.env.NODE_ENV === "test" || process.env.CI === "true") {
      await next();
      return;
    }

    const method = c.req.method;
    const pattern = routePath(c);
    const key = `${method}_${pattern}_${identity(c)}`;

    try {
      const result = await limiter.consume(key);
      c.header("X-RateLimit-Limit", limiter.points.toString());
      c.header("X-RateLimit-Remaining", result.remainingPoints.toString());
      c.header(
        "X-RateLimit-Reset",
        (Date.now() + result.msBeforeNext).toString(),
      );
    } catch (rejection) {
      if (!(rejection instanceof RateLimiterRes)) {
        // Do not treat Redis failures as rate-limit rejections.
        throw rejection;
      }
      const retryAfterSeconds = Math.ceil(rejection.msBeforeNext / 1000);
      c.header("X-RateLimit-Limit", limiter.points.toString());
      c.header("X-RateLimit-Remaining", rejection.remainingPoints.toString());
      c.header(
        "X-RateLimit-Reset",
        (Date.now() + rejection.msBeforeNext).toString(),
      );
      c.header("Retry-After", retryAfterSeconds.toString());
      return c.json(
        { errors: `Too many requests. Try again in ${retryAfterSeconds}s.` },
        429,
      );
    }
    await next();
  };
};

export const authLimiterMiddleware = createLimiterMiddleware(authRateLimiter);
export const writeLimiterMiddleware = createLimiterMiddleware(writeRateLimiter);
export const readLimiterMiddleware = createLimiterMiddleware(readRateLimiter);
export const internalPreAuthLimiterMiddleware = createLimiterMiddleware(
  internalPreAuthRateLimiter,
);
export const internalLimiterMiddleware = createLimiterMiddleware(
  internalRateLimiter,
  (c) => c.get("clientId") || getClientIp(c),
);

// Admin reads and writes use separate buckets.
export const adminLimiterMiddleware = async (c: Context, next: Next) => {
  const limiter =
    c.req.method === "GET" ? readLimiterMiddleware : writeLimiterMiddleware;
  return limiter(c, next);
};
