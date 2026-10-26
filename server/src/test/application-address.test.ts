import { describe, expect, it } from "bun:test";
import { addressConflict, isLocalHost, originSharedWith, sameAddress } from "../utils/application-address";

const row = (application_id: string, launch_url: string | null, retired_at: Date | null = null) => ({ application_id, name: application_id.toUpperCase(), launch_url, retired_at });

describe("application address", () => {
  it("treats case, a trailing slash and the port as the address", () => {
    expect(sameAddress("http://LOCALHOST:3001/auth/sso/", "http://localhost:3001/auth/sso")).toBe(true);
    expect(sameAddress("http://localhost:3001/auth/sso", "http://localhost:3002/auth/sso")).toBe(false);
    expect(sameAddress("http://localhost:3001/auth/sso", "http://localhost:3001/api/v1/auth/sso")).toBe(false);
    expect(sameAddress(null, "http://localhost:3001")).toBe(false);
  });

  it("finds a live application with the same address, never itself or a retired one", () => {
    const others = [row("exima", "https://apps.example.com/auth/sso"), row("old", "https://apps.example.com/x", new Date())];
    expect(addressConflict("https://apps.example.com/auth/sso", others)?.application_id).toBe("exima");
    expect(addressConflict("https://apps.example.com/auth/sso", others, "exima")).toBeUndefined();
    expect(addressConflict("https://apps.example.com/x", others)).toBeUndefined();
  });

  it("lets a domain be shared by path, but not a port on a local host", () => {
    const domain = [row("daily", "https://apps.example.com/daily/auth/sso")];
    expect(addressConflict("https://apps.example.com/mtss/auth/sso", domain)).toBeUndefined();
    const local = [row("exima", "http://localhost:3001/auth/sso")];
    expect(addressConflict("http://localhost:3001/api/v1/auth/sso", local)?.application_id).toBe("exima");
    expect(addressConflict("http://localhost:3002/api/v1/auth/sso", local)).toBeUndefined();
    expect(addressConflict("http://127.0.0.1:3001/x", [row("a", "http://127.0.0.1:3001/y")])?.application_id).toBe("a");
    expect(isLocalHost("https://apps.example.com")).toBe(false);
  });

  it("names the other live applications on the same origin", () => {
    const others = [row("daily", "https://apps.example.com/daily/auth/sso"), row("mtss", "https://apps.example.com/mtss/auth/sso"), row("other", "https://elsewhere.example.com/")];
    expect(originSharedWith("https://apps.example.com/mtss/auth/sso", others, "mtss")).toEqual(["DAILY"]);
    expect(originSharedWith(null, others, "mtss")).toEqual([]);
  });
});
