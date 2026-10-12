import { describe, expect, it } from "bun:test";
import { deriveAppSecret, secretVersion } from "../utils/hub-app-secret";

describe("hub app secret", () => {
  it("is the same for the same input and differs by application, version and master", () => {
    const secret = deriveAppSecret("master-one", "exima", 1);
    expect(deriveAppSecret("master-one", "exima", 1)).toBe(secret);
    expect(deriveAppSecret("master-one", "daily-checkin", 1)).not.toBe(secret);
    expect(deriveAppSecret("master-one", "exima", 2)).not.toBe(secret);
    expect(deriveAppSecret("master-two", "exima", 1)).not.toBe(secret);
  });

  it("carries its version and does not contain the master", () => {
    const secret = deriveAppSecret("master-one", "exima", 3);
    expect(secret).toMatch(/^v3\.[0-9a-f]{64}$/);
    expect(secret).not.toContain("master-one");
    expect(secretVersion(secret)).toBe(3);
    expect(secretVersion("master-one")).toBeNull();
    expect(secretVersion("v1.nothex")).toBeNull();
  });

  // The Hub makes the same secret to check one. If this vector changes, the Hub's copy has to change with it.
  // The Hub makes the same secret to check one. If this vector changes, the Hub's copy has to change with it.
  it("matches the vector the Hub is tested against", () => {
    expect(deriveAppSecret("0123456789abcdef0123456789abcdef", "exima", 1)).toBe(
      "v1.c25303f7dc302ea96af146bccb096b61b0ea6705ba67ec29d08e975935779a15",
    );
  });
});
