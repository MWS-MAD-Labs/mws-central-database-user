import { afterEach, describe, expect, it } from "bun:test";
import { judgeBurst, percentile, runBurst, sendOne } from "../../scripts/rate-limit-check";

// A server that answers 200 for the first `allowed` requests and 429 after, with the headers Central sends.
function limitedServer(allowed: number) {
  let seen = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      seen += 1;
      const refused = seen > allowed;
      return new Response("{}", {
        status: refused ? 429 : 200,
        headers: {
          "x-ratelimit-limit": String(allowed),
          "x-ratelimit-remaining": String(Math.max(0, allowed - seen)),
          ...(refused ? { "retry-after": "7" } : {}),
        },
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/x`, stop: () => server.stop(true) };
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

describe("rate limit check", () => {
  it("reads the limit headers of an answer", async () => {
    const server = limitedServer(5);
    stop = server.stop;
    const sample = await sendOne(server.url, {});
    expect(sample).toMatchObject({ status: 200, limit: 5, remaining: 4, retryAfter: null });
  });

  it("counts the answers of a burst, the lowest Remaining and the Retry-After", async () => {
    const server = limitedServer(10);
    stop = server.stop;
    const summary = await runBurst({ url: server.url, init: {}, total: 25, concurrency: 5 });
    expect(summary.statuses).toEqual({ "200": 10, "429": 15 });
    expect(summary.limit).toBe(10);
    expect(summary.lowestRemaining).toBe(0);
    expect(summary.retryAfters).toEqual([7]);
    expect(summary.firstRefusedAt).not.toBeNull();
  });

  it("judges a burst against what was expected", async () => {
    const server = limitedServer(10);
    stop = server.stop;
    const refused = await runBurst({ url: server.url, init: {}, total: 20, concurrency: 4 });
    expect(judgeBurst(refused, "limited")).toBeNull();
    expect(judgeBurst(refused, "ok")).toContain("Expected no 429");
    expect(judgeBurst(refused, undefined)).toBeNull();

    const quiet = { ...refused, statuses: { "200": 20 }, retryAfters: [] };
    expect(judgeBurst(quiet, "ok")).toBeNull();
    expect(judgeBurst(quiet, "limited")).toContain("none was refused");
    expect(judgeBurst({ ...refused, retryAfters: [] }, "limited")).toContain("Retry-After");
  });

  it("counts a request that got no answer, and says the result says little", async () => {
    const summary = await runBurst({ url: "http://127.0.0.1:1/x", init: {}, total: 3, concurrency: 2 });
    expect(summary.statuses).toEqual({ "0": 3 });
    expect(judgeBurst(summary, "ok")).toContain("no answer");
  });

  it("takes percentiles of a list", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
  });
});
