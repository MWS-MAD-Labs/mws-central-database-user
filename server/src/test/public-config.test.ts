import { afterEach, describe, expect, it } from "bun:test";
import { TestRequest } from "./test-utils";
import { productionUrl } from "../utils/public-config";

describe("productionUrl", () => {
  it("is empty when nothing is set", () => {
    expect(productionUrl({})).toBeNull();
    expect(productionUrl({ PRODUCTION_URL: "   " })).toBeNull();
  });

  it("drops the trailing slash and keeps the address", () => {
    expect(productionUrl({ PRODUCTION_URL: "https://central.example.org/" })).toBe("https://central.example.org");
    expect(productionUrl({ PRODUCTION_URL: " https://central.example.org " })).toBe("https://central.example.org");
  });

  it("ignores what is not a web address", () => {
    expect(productionUrl({ PRODUCTION_URL: "central.example.org" })).toBeNull();
    expect(productionUrl({ PRODUCTION_URL: "javascript:alert(1)" })).toBeNull();
    expect(productionUrl({ PRODUCTION_URL: "ftp://central.example.org" })).toBeNull();
  });
});

describe("GET /api/public-config", () => {
  const before = process.env.PRODUCTION_URL;
  afterEach(() => {
    if (before === undefined) delete process.env.PRODUCTION_URL;
    else process.env.PRODUCTION_URL = before;
  });

  it("answers without signing in, null when no address is set", async () => {
    delete process.env.PRODUCTION_URL;
    const response = await TestRequest.get("/api/public-config");
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ production_url: null });
  });

  it("gives the address of the real application on staging", async () => {
    process.env.PRODUCTION_URL = "https://central.example.org/";
    const response = await TestRequest.get("/api/public-config");
    expect((await response.json()).data).toEqual({ production_url: "https://central.example.org" });
  });
});
