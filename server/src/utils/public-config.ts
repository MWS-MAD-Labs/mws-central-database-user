// The address of the real application. Set only on the staging deploy, so the app can say it is a test version.
// Anything that is not a web address is ignored.
export function productionUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.PRODUCTION_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
