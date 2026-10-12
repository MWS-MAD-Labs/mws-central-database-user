import { afterEach, describe, expect, it } from "bun:test";
import { decryptSecret, encryptSecret, newSecret } from "../utils/secret-box";

const original = process.env.APP_SECRETS_KEY;

afterEach(() => {
  process.env.APP_SECRETS_KEY = original;
});

describe("secret box", () => {
  it("reads back what it kept, and never keeps it as it is", () => {
    const stored = encryptSecret("shared-secret");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("shared-secret");
    expect(decryptSecret(stored)).toBe("shared-secret");
    // A fresh vector every time.
    expect(encryptSecret("shared-secret")).not.toBe(stored);
  });

  it("makes long random secrets", () => {
    expect(newSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(newSecret()).not.toBe(newSecret());
  });

  it("refuses without a usable key, and with the wrong one", () => {
    const stored = encryptSecret("x");
    delete process.env.APP_SECRETS_KEY;
    expect(() => encryptSecret("x")).toThrow(/APP_SECRETS_KEY is not set/);
    process.env.APP_SECRETS_KEY = Buffer.alloc(10).toString("base64");
    expect(() => decryptSecret(stored)).toThrow(/32 bytes/);
    process.env.APP_SECRETS_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptSecret(stored)).toThrow(/cannot be read/);
    expect(() => decryptSecret("not-a-secret")).toThrow(/known format/);
  });
});
