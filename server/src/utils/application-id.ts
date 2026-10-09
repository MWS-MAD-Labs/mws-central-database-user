// The id of an application is made from its name: "MWS Hub" becomes "mws-hub".
export function slugifyApplicationId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!slug) return "";
  // An id starts with a letter.
  return /^[a-z]/.test(slug) ? slug : `app-${slug}`.slice(0, 64).replace(/-+$/g, "");
}

const ADDRESS_CHARACTERS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
const PRIVATE_IPV4 = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

// Where http is fine: this machine, a local name, or a private network address.
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".test") ||
    !host.includes(".") ||
    PRIVATE_IPV4.test(host)
  );
}

// What is wrong with an address, in plain words, or null when it is fine.
export function addressProblem(value: string): string | null {
  if (/\s/.test(value)) return "No spaces allowed";
  if (!ADDRESS_CHARACTERS.test(value)) return "Use only letters, numbers and the usual address symbols";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "This is not a valid address";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Start with http:// or https://";
  if (url.username || url.password) return "Leave the user name and password out of the address";
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    return "Only a local address may use http. Use https for anything else";
  }
  return null;
}
