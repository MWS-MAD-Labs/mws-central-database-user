import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { TestRequest } from "./test-utils";
import { redis } from "../lib/redis";

// The middleware bypasses entirely when NODE_ENV=test (how this whole suite
// runs) - flip it off for the duration of each test here so the real
// sliding-window logic actually executes, then always restore it.
let originalNodeEnv: string | undefined;

function uniqueTestIp(label: string): string {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function clearRateLimitKeys() {
  const keys = await redis.keys("ratelimit_*");
  if (keys.length > 0) await redis.del(...keys);
}

describe("Rate limiting", () => {
  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    await clearRateLimitKeys();
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await clearRateLimitKeys();
  });

  it("allows up to 5 requests per IP on /api/auth/google, then blocks with 429", async () => {
    const ip = uniqueTestIp("auth-block");

    for (let i = 0; i < 5; i++) {
      const response = await TestRequest.post(
        "/api/auth/google",
        {},
        undefined,
        { "x-forwarded-for": ip },
      );
      expect(response.status).not.toBe(429);
    }

    const blocked = await TestRequest.post(
      "/api/auth/google",
      {},
      undefined,
      { "x-forwarded-for": ip },
    );
    const body = await blocked.json();

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(body.errors).toContain("Too many requests");
  });

  it("scopes the limit per IP - a different IP is unaffected", async () => {
    const blockedIp = uniqueTestIp("auth-scoped-a");

    for (let i = 0; i < 5; i++) {
      await TestRequest.post("/api/auth/google", {}, undefined, {
        "x-forwarded-for": blockedIp,
      });
    }
    const stillBlocked = await TestRequest.post(
      "/api/auth/google",
      {},
      undefined,
      { "x-forwarded-for": blockedIp },
    );
    expect(stillBlocked.status).toBe(429);

    const otherIp = uniqueTestIp("auth-scoped-b");
    const unaffected = await TestRequest.post(
      "/api/auth/google",
      {},
      undefined,
      { "x-forwarded-for": otherIp },
    );
    expect(unaffected.status).not.toBe(429);
  });

  it("applies the more generous read limit (not the 5-request auth limit) to /api/auth/refresh", async () => {
    const ip = uniqueTestIp("refresh");

    // 6 requests would already trip authLimiter's 5/15min cap - proves
    // refresh runs through readLimiter instead.
    for (let i = 0; i < 6; i++) {
      const response = await TestRequest.post(
        "/api/auth/refresh",
        {},
        undefined,
        { "x-forwarded-for": ip },
      );
      expect(response.status).not.toBe(429);
    }
  });

  it("applies the write limit (20/min) to non-GET admin requests, regardless of auth outcome", async () => {
    const ip = uniqueTestIp("admin-write");

    // No access token - every request 401s at adminAuthMiddleware, but that
    // happens *after* the rate limiter, so the count still climbs.
    for (let i = 0; i < 20; i++) {
      const response = await TestRequest.post(
        "/api/admin/units",
        { name: `rl-test-${i}` },
        undefined,
        { "x-forwarded-for": ip },
      );
      expect(response.status).not.toBe(429);
    }

    const blocked = await TestRequest.post(
      "/api/admin/units",
      { name: "rl-test-overflow" },
      undefined,
      { "x-forwarded-for": ip },
    );
    expect(blocked.status).toBe(429);
  });

  it("applies a separate, more generous read limit to GET admin requests", async () => {
    const ip = uniqueTestIp("admin-read");

    // 25 requests would already have tripped the 20/min write limit above -
    // proves GET runs through readLimiter, not writeLimiter.
    for (let i = 0; i < 25; i++) {
      const response = await TestRequest.get("/api/admin/units", undefined, {
        "x-forwarded-for": ip,
      });
      expect(response.status).not.toBe(429);
    }
  });

  it("keeps the internal API limit independent of the admin write limit", async () => {
    const ip = uniqueTestIp("internal");

    // Also more than the 20/min admin write limit - proves /api/internal/*
    // has its own bucket (keyed by route, not shared with /api/admin/*).
    for (let i = 0; i < 25; i++) {
      const response = await TestRequest.get(
        "/api/internal/employees/lookup?email=nobody@millennia21.id",
        undefined,
        { "x-forwarded-for": ip },
      );
      expect(response.status).not.toBe(429);
    }
  });

  it("bypasses rate limiting entirely when NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    const ip = uniqueTestIp("bypass");

    for (let i = 0; i < 10; i++) {
      const response = await TestRequest.post(
        "/api/auth/google",
        {},
        undefined,
        { "x-forwarded-for": ip },
      );
      expect(response.status).not.toBe(429);
    }
  });
});
