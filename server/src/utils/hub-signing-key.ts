import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";

export type HubSigningKey = {
  kid: string;
  // PKCS#8 PEM. Shown once, never stored.
  privatePem: string;
  thumbprint: string;
};



// RFC 7638: SHA-256 of the required members in order, base64url.
export function thumbprintOf(jwk: JsonWebKey | Record<string, unknown>): string | null {
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") return null;
  return createHash("sha256").update(JSON.stringify({ e: jwk.e, kty: "RSA", n: jwk.n })).digest("base64url");
}

export function defaultKid(now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `mws-hub-sso-${now.getUTCFullYear()}-${month}-${randomBytes(2).toString("hex")}`;
}

export function makeHubSigningKey(kid = defaultKid()): HubSigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return {
    kid,
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    thumbprint: thumbprintOf(jwk) as string,
  };
}

// The .env wants the PEM on one line, with each line break written as \n.
export function pemForEnv(pem: string): string {
  return pem.trim().replace(/\r?\n/g, "\\n");
}
