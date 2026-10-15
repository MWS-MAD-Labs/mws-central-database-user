const DOTS = "••••••••••••";

// What the token dialog shows instead of the token: the start and the end, a fixed run of dots in
// between so the length does not leak. A short token shows only its first two characters.
export function maskToken(token) {
  if (!token) return "";
  if (token.length <= 16) return `${token.slice(0, 2)}${DOTS}`;
  return `${token.slice(0, 10)}${DOTS}${token.slice(-4)}`;
}
