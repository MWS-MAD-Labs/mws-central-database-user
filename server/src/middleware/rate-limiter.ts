import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { redis } from "../lib/redis";
import type { Context, Next } from "hono";
import { getConnInfo } from "hono/bun";
import { routePath } from "hono/route";

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
  points: 100,
  duration: 3 * 60,
  keyPrefix: "ratelimit_read",
});

// Internal API (called server-to-server by other apps like mws-daily-checkin,
// not individual browsers) - more lenient than admin read/write.
const internalRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  points: 300,
  duration: 60,
  keyPrefix: "ratelimit_internal",
});

function getClientIp(c: Context): string {
  const info = getConnInfo(c);
  return (
    c.req.header("x-forwarded-for")?.split(",")[0] ||
    info.remote.address ||
    "unknown_ip"
  );
}

const createLimiterMiddleware = (limiter: RateLimiterRedis) => {
  return async (c: Context, next: Next) => {
    if (process.env.NODE_ENV === "test" || process.env.CI === "true") {
      await next();
      return;
    }

    const ip = getClientIp(c);
    const method = c.req.method;
    const pattern = routePath(c);
    const key = `${method}_${pattern}_${ip}`;

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
        // A real error talking to Redis, not a rate-limit rejection - don't
        // silently fail-closed on infra trouble.
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
export const internalLimiterMiddleware =
  createLimiterMiddleware(internalRateLimiter);

// Admin routes are read-heavy (GET) and write (POST/PUT/PATCH/DELETE) mixed
// under the same router - branch by method instead of wiring every single
// admin sub-router by hand.
export const adminLimiterMiddleware = async (c: Context, next: Next) => {
  const limiter =
    c.req.method === "GET" ? readLimiterMiddleware : writeLimiterMiddleware;
  return limiter(c, next);
};
