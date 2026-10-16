import { describe, expect, it } from "bun:test";
import { publicBaseUrlFrom } from "../controller/admin/application-entitlement-controller";

const url = new URL("http://server:3000/api/admin/x");

describe("publicBaseUrlFrom", () => {
  it("uses the configured address, without a trailing slash", () => {
    expect(publicBaseUrlFrom("https://db.example.id/", { proto: "http", host: "x" }, url, true)).toBe("https://db.example.id");
  });

  it("keeps what the proxy forwarded", () => {
    expect(publicBaseUrlFrom(undefined, { proto: "https", host: "db-stg.example.id" }, url, true)).toBe("https://db-stg.example.id");
    expect(publicBaseUrlFrom(undefined, { proto: "https, http", host: "db.example.id" }, url, true)).toBe("https://db.example.id");
  });

  it("makes a public host https in production when the proxy said http", () => {
    expect(publicBaseUrlFrom(undefined, { proto: "http", host: "db-stg.example.id" }, url, true)).toBe("https://db-stg.example.id");
    expect(publicBaseUrlFrom(undefined, { host: "db-stg.example.id" }, url, true)).toBe("https://db-stg.example.id");
  });

  it("leaves http for local work and private networks", () => {
    expect(publicBaseUrlFrom(undefined, { proto: "http", host: "localhost:3000" }, url, true)).toBe("http://localhost:3000");
    expect(publicBaseUrlFrom(undefined, { proto: "http", host: "192.168.1.5:3000" }, url, true)).toBe("http://192.168.1.5:3000");
  });

  it("does not touch the scheme outside production", () => {
    expect(publicBaseUrlFrom(undefined, { proto: "http", host: "db-stg.example.id" }, url, false)).toBe("http://db-stg.example.id");
  });
});
