import { describe, expect, it } from 'bun:test';
import { isHexColor, readableOn } from "../../../src/features/application-access/utils/iconBackground.js";

describe("icon background helpers", () => {
  it("accepts only six digit hex colours", () => {
    expect(isHexColor("#1F2A44")).toBe(true);
    expect(isHexColor("#1f2a44")).toBe(true);
    expect(isHexColor("#FFF")).toBe(false);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("")).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });

  it("picks dark text on light colours and light text on dark ones", () => {
    expect(readableOn("#FFFFFF")).toBe("#1F2A44");
    expect(readableOn("#FBF2DF")).toBe("#1F2A44");
    expect(readableOn("#7E1518")).toBe("#FFFFFF");
    expect(readableOn("#1F2A44")).toBe("#FFFFFF");
    expect(readableOn("nope")).toBeUndefined();
  });
});
