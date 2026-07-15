import { randomBytes, timingSafeEqual } from "crypto";
import { hashToken } from "./hash-token";

const TOKEN_PREFIX_RANDOM_BYTES = 6; // 12 hex chars
const TOKEN_SECRET_BYTES = 32; // 64 hex chars

export type GeneratedApiToken = {
  // Plaintext token, returned to the admin exactly once at creation time.
  // Never stored — only its parts (token_prefix in plain, secret as a hash) are.
  token: string;
  token_prefix: string;
  token_hash: string;
};

export function generateApiToken(): GeneratedApiToken {
  const tokenPrefix = `mws_${randomBytes(TOKEN_PREFIX_RANDOM_BYTES).toString("hex")}`;
  const secret = randomBytes(TOKEN_SECRET_BYTES).toString("hex");

  return {
    token: `${tokenPrefix}.${secret}`,
    token_prefix: tokenPrefix,
    token_hash: hashToken(secret),
  };
}

// Constant-time comparison so a caller can't learn how much of the secret
// they got right from response timing.
export function verifyApiTokenSecret(
  secret: string,
  storedHash: string,
): boolean {
  const candidateHash = Buffer.from(hashToken(secret), "hex");
  const actualHash = Buffer.from(storedHash, "hex");

  if (candidateHash.length !== actualHash.length) {
    return false;
  }

  return timingSafeEqual(candidateHash, actualHash);
}
