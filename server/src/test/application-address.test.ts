import { describe, expect, it } from "bun:test";
import { addressTakenBy, originSharedWith, sameAddress } from "../utils/application-address";

const row = (application_id: string, launch_url: string | null, retired_at: Date | null = null) => ({ application_id, name: application_id.toUpperCase(), launch_url, retired_at });

describe("application address", () => {
  it("treats case, a trailing slash and the port as the address", () => {
    expect(sameAddress("http://LOCALHOST:3001/auth/sso/", "http://localhost:3001/auth/sso")).toBe(true);
    expect(sameAddress("http://localhost:3001/auth/sso", "http://localhost:3002/auth/sso")).toBe(false);
    expect(sameAddress("http://localhost:3001/auth/sso", "http://localhost:3001/api/v1/auth/sso")).toBe(false);
    expect(sameAddress(null, "http://localhost:3001")).toBe(false);
  });

  it("finds a live application with the same address, never itself or a retired one", () => {
    const others = [row("exima", "http://localhost:3001/auth/sso"), row("old", "http://localhost:3001/x", new Date())];
    expect(addressTakenBy("http://localhost:3001/auth/sso", others)?.application_id).toBe("exima");
    expect(addressTakenBy("http://localhost:3001/auth/sso", others, "exima")).toBeUndefined();
    expect(addressTakenBy("http://localhost:3001/x", others)).toBeUndefined();
  });

  it("names the other live applications on the same origin", () => {
    const others = [row("daily", "https://apps.example.com/daily/auth/sso"), row("mtss", "https://apps.example.com/mtss/auth/sso"), row("other", "https://elsewhere.example.com/")];
    expect(originSharedWith("https://apps.example.com/mtss/auth/sso", others, "mtss")).toEqual(["DAILY"]);
    expect(originSharedWith(null, others, "mtss")).toEqual([]);
  });
});
