// Checks Central's rate limits from the outside, against a deployed Central. The limiter is skipped when CI=true, so
// this is the only way to see the real thing. Use it on STAGING with the staging token: a burst really spends the limit
// of the token and would shut out the people using that Central.
//
//   bun run scripts/rate-limit-check.ts header --base https://<central>/api/internal [--expect-limit 1200]
//   bun run scripts/rate-limit-check.ts burst  --base https://<central>/api/internal --total 300 --concurrency 50 --yes [--expect ok|limited]
//   bun run scripts/rate-limit-check.ts auth   --base https://<central> [--count 3]
//
// The token comes from CENTRAL_API_TOKEN (not from an argument, so it stays out of the shell history), and
// CENTRAL_ORGANIZATION_ID is sent as X-Central-Organization-Id when set.
//
//   header  one request, prints the limit and what is left. --expect-limit fails when the limit is another number
//           (the internal bucket is 1200 per minute unless INTERNAL_RATE_LIMIT_POINTS says otherwise).
//   burst   many requests at once. Prints how many were answered 200 and 429, the lowest Remaining, the Retry-After
//           values and the time. --expect ok fails on any 429, --expect limited fails when none was refused.
//   auth    sends a few empty sign-in requests and prints Remaining after each. Run it from two devices: if each
//           starts again at 4, every person has their own bucket. If the second continues from the first, the server
//           sees one address for everybody (TRUST_PROXY or nginx is wrong).

export type Sample = { status: number; remaining: number | null; limit: number | null; retryAfter: number | null; ms: number };

export type BurstSummary = {
  total: number;
  statuses: Record<string, number>;
  limit: number | null;
  lowestRemaining: number | null;
  retryAfters: number[];
  firstRefusedAt: number | null;
  p50: number;
  p95: number;
  elapsedMs: number;
};

const numberOf = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

export async function sendOne(url: string, init: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Sample> {
  const started = performance.now();
  try {
    const response = await fetchImpl(url, init);
    await response.arrayBuffer().catch(() => undefined);
    return {
      status: response.status,
      remaining: numberOf(response.headers.get("x-ratelimit-remaining")),
      limit: numberOf(response.headers.get("x-ratelimit-limit")),
      retryAfter: numberOf(response.headers.get("retry-after")),
      ms: performance.now() - started,
    };
  } catch {
    // A request that never got an answer counts as status 0, so it shows in the summary.
    return { status: 0, remaining: null, limit: null, retryAfter: null, ms: performance.now() - started };
  }
}

export async function runBurst(options: {
  url: string;
  init: RequestInit;
  total: number;
  concurrency: number;
  fetchImpl?: typeof fetch;
}): Promise<BurstSummary> {
  const samples: Sample[] = new Array(options.total);
  let next = 0;
  const started = performance.now();
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= options.total) return;
      samples[index] = await sendOne(options.url, options.init, options.fetchImpl);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, options.total)) }, worker));
  const elapsedMs = performance.now() - started;

  const statuses: Record<string, number> = {};
  for (const sample of samples) statuses[String(sample.status)] = (statuses[String(sample.status)] ?? 0) + 1;
  const remaining = samples.map((sample) => sample.remaining).filter((value): value is number => value !== null);
  const firstRefused = samples.findIndex((sample) => sample.status === 429);
  return {
    total: options.total,
    statuses,
    limit: samples.map((sample) => sample.limit).find((value) => value !== null) ?? null,
    lowestRemaining: remaining.length ? Math.min(...remaining) : null,
    retryAfters: [...new Set(samples.map((sample) => sample.retryAfter).filter((value): value is number => value !== null))].sort((a, b) => a - b),
    firstRefusedAt: firstRefused >= 0 ? firstRefused + 1 : null,
    p50: Math.round(percentile(samples.map((sample) => sample.ms), 50)),
    p95: Math.round(percentile(samples.map((sample) => sample.ms), 95)),
    elapsedMs: Math.round(elapsedMs),
  };
}

// Whether a burst ended the way the caller expected. `ok`: nobody was refused. `limited`: somebody was, with Retry-After.
export function judgeBurst(summary: BurstSummary, expect: "ok" | "limited" | undefined): string | null {
  const refused = summary.statuses["429"] ?? 0;
  const failed = summary.statuses["0"] ?? 0;
  if (failed > 0) return `${failed} requests got no answer, so the result says little. Check the address and the network.`;
  if (expect === "ok" && refused > 0) return `Expected no 429, got ${refused}.`;
  if (expect === "limited") {
    if (refused === 0) return "Expected the limit to refuse some requests, none was refused. Send more requests than the limit.";
    if (summary.retryAfters.length === 0) return "Requests were refused without a Retry-After header.";
  }
  return null;
}

function parseArgs(argv: string[]) {
  const [mode, ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const item = rest[i]!;
    if (!item.startsWith("--")) continue;
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags.set(item.slice(2), "true");
    else {
      flags.set(item.slice(2), next);
      i++;
    }
  }
  return { mode, flags };
}

const integer = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

async function main() {
  const { mode, flags } = parseArgs(process.argv.slice(2));
  const base = flags.get("base")?.replace(/\/+$/, "");
  if (!mode || !["header", "burst", "auth"].includes(mode) || !base) {
    console.error("Usage: bun run scripts/rate-limit-check.ts <header|burst|auth> --base <url> [options]. See the top of the file.");
    process.exit(2);
  }

  const token = process.env.CENTRAL_API_TOKEN?.trim();
  const organization = process.env.CENTRAL_ORGANIZATION_ID?.trim();
  const authHeaders: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(organization ? { "x-central-organization-id": organization } : {}),
  };

  if (mode === "auth") {
    const count = integer(flags.get("count"), 3);
    console.log(`Sending ${count} empty sign-in requests to ${new URL(base).host}`);
    const remaining: (number | null)[] = [];
    for (let i = 0; i < count; i++) {
      const sample = await sendOne(`${base}/api/auth/google`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      remaining.push(sample.remaining);
      console.log(`  ${i + 1}: status ${sample.status}, remaining ${sample.remaining ?? "-"} of ${sample.limit ?? "-"}`);
    }
    console.log("Run this from a second device. If it starts again at 4, every person has their own bucket.");
    return;
  }

  if (!token) {
    console.error("Set CENTRAL_API_TOKEN to the token of the API client to test (the staging one).");
    process.exit(2);
  }
  const path = flags.get("path") ?? "/application-taxonomy";
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  if (mode === "header") {
    const sample = await sendOne(url, { headers: authHeaders });
    console.log(`status ${sample.status}, limit ${sample.limit ?? "-"}, remaining ${sample.remaining ?? "-"}`);
    const expected = flags.get("expect-limit");
    if (expected && sample.limit !== Number(expected)) {
      console.error(`Expected a limit of ${expected}, the server says ${sample.limit ?? "nothing"}. Is the new Central deployed?`);
      process.exit(1);
    }
    return;
  }

  const total = integer(flags.get("total"), 300);
  const concurrency = integer(flags.get("concurrency"), 50);
  if (flags.get("yes") !== "true") {
    console.error(`This sends ${total} requests to ${new URL(url).host} and spends the rate limit of the token. Only run it against staging with the staging token. Add --yes to go on.`);
    process.exit(2);
  }
  console.log(`Sending ${total} requests, ${concurrency} at a time, to ${new URL(url).host}${path}`);
  const summary = await runBurst({ url, init: { headers: authHeaders }, total, concurrency });
  console.log(`answers: ${Object.entries(summary.statuses).map(([status, n]) => `${status} x${n}`).join(", ")}`);
  console.log(`limit ${summary.limit ?? "-"}, lowest remaining ${summary.lowestRemaining ?? "-"}, first refused at request ${summary.firstRefusedAt ?? "none"}`);
  console.log(`Retry-After: ${summary.retryAfters.length ? summary.retryAfters.join(", ") + " s" : "none"}; time ${summary.elapsedMs} ms (p50 ${summary.p50} ms, p95 ${summary.p95} ms)`);
  const expect = flags.get("expect");
  const problem = judgeBurst(summary, expect === "ok" || expect === "limited" ? expect : undefined);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}

if (import.meta.main) await main();
