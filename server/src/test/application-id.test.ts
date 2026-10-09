import { describe, expect, it } from "bun:test";
import { addressProblem, slugifyApplicationId } from "../utils/application-id";

describe("slugifyApplicationId", () => {
  it("turns a name into an id", () => {
    expect(slugifyApplicationId("MWS Hub")).toBe("mws-hub");
    expect(slugifyApplicationId("  Daily   Check-in ")).toBe("daily-check-in");
    expect(slugifyApplicationId("Café & Co.")).toBe("cafe-co");
  });

  it("starts with a letter and stays short", () => {
    expect(slugifyApplicationId("2024 Report")).toBe("app-2024-report");
    expect(slugifyApplicationId("a".repeat(100))).toHaveLength(64);
    expect(slugifyApplicationId("---")).toBe("");
  });
});

describe("addressProblem", () => {
  it("accepts https and local http", () => {
    expect(addressProblem("https://exima.mws.web.id/auth/sso")).toBeNull();
    expect(addressProblem("http://localhost:3000/auth")).toBeNull();
    expect(addressProblem("http://192.168.1.20:3000")).toBeNull();
    expect(addressProblem("http://exima/auth")).toBeNull();
  });

  it("says what is wrong", () => {
    expect(addressProblem("https://a b.com")).toContain("spaces");
    expect(addressProblem("http://example.com")).toContain("local");
    expect(addressProblem("ftp://example.com")).toContain("http");
    expect(addressProblem("https://u:p@example.com")).toContain("user name");
    expect(addressProblem("https://example.com/<x>")).toContain("symbols");
  });
});
