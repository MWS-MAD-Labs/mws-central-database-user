import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { redis } from "../lib/redis";
import { withLookupCache } from "../lib/lookup-cache";

// Disable test and CI cache bypasses while exercising cache behavior.
let originalNodeEnv: string | undefined;
let originalCi: string | undefined;

async function clearLookupCacheKeys() {
  const keys = await redis.keys("lookup_cache:*");
  if (keys.length > 0) await redis.del(...keys);
}

describe("withLookupCache", () => {
  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    originalCi = process.env.CI;
    process.env.NODE_ENV = "development";
    delete process.env.CI;
    await clearLookupCacheKeys();
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalCi !== undefined) process.env.CI = originalCi;
    await clearLookupCacheKeys();
  });

  it("caches a real (non-null) value across calls", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { id: "person-1" };
    };

    const first = await withLookupCache("test-ns", ["a@example.com"], fetcher);
    expect(first.cached).toBe(false);
    expect(first.value).toEqual({ id: "person-1" });

    const second = await withLookupCache("test-ns", ["a@example.com"], fetcher);
    expect(second.cached).toBe(true);
    expect(second.value).toEqual({ id: "person-1" });

    expect(calls).toBe(1);
  });

  it("never caches a null (not-found) result - every call re-fetches", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return null;
    };

    const first = await withLookupCache("test-ns", ["missing@example.com"], fetcher);
    expect(first.cached).toBe(false);
    expect(first.value).toBeNull();

    const second = await withLookupCache("test-ns", ["missing@example.com"], fetcher);
    expect(second.cached).toBe(false);
    expect(second.value).toBeNull();

    expect(calls).toBe(2);
  });

  it("picks up a value that appears after an earlier not-found call, with no stale window", async () => {
    let found = false;
    const fetcher = async () => (found ? { id: "person-2" } : null);

    const miss = await withLookupCache("test-ns", ["late@example.com"], fetcher);
    expect(miss.value).toBeNull();

    found = true;
    const hit = await withLookupCache("test-ns", ["late@example.com"], fetcher);
    expect(hit.cached).toBe(false);
    expect(hit.value).toEqual({ id: "person-2" });
  });

  // Used by id-based Employee/Student lookups - always a re-verification of
  // someone already resolved once (see mws-hub's resolveCentralIdentityById),
  // so the whole point is never serving a stale answer, even within the
  // otherwise-normal 5-minute cache window.
  it("skipCache: true re-fetches every call, even for a real value that would otherwise be cached", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { id: `person-${calls}` };
    };

    const first = await withLookupCache("test-ns", ["id-1"], fetcher, { skipCache: true });
    expect(first.cached).toBe(false);
    expect(first.value).toEqual({ id: "person-1" });

    const second = await withLookupCache("test-ns", ["id-1"], fetcher, { skipCache: true });
    expect(second.cached).toBe(false);
    expect(second.value).toEqual({ id: "person-2" });

    expect(calls).toBe(2);
  });

  it("skipCache: true never writes a cache entry another (cache-enabled) call could later read", async () => {
    const fetcher = async () => ({ id: "person-x" });

    await withLookupCache("test-ns", ["shared-key"], fetcher, { skipCache: true });

    const followUp = await withLookupCache("test-ns", ["shared-key"], fetcher);
    expect(followUp.cached).toBe(false);
  });
});
