import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { ResponseError } from "../error/response-error";

const PREFIX = "v1";

// 32 bytes in base64, from the .env of Central.
function key(): Buffer {
  const raw = process.env.APP_SECRETS_KEY?.trim();
  if (!raw) throw new ResponseError(503, "APP_SECRETS_KEY is not set in Central's .env, so a secret cannot be kept or read");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new ResponseError(503, "APP_SECRETS_KEY must be 32 bytes in base64");
  return bytes;
}

// A secret Central has to show again later, so it cannot be hashed. Kept encrypted instead.
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [prefix, iv, tag, body] = stored.split(":");
  if (prefix !== PREFIX || !iv || !tag || !body) throw new ResponseError(500, "A stored secret is not in a known format");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof ResponseError) throw error;
    throw new ResponseError(503, "The stored secret cannot be read with this APP_SECRETS_KEY");
  }
}

export function newSecret(): string {
  return randomBytes(32).toString("hex");
}
