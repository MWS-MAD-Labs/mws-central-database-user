import { describe, expect, test } from "bun:test";
import { clamp, isUntouched, placement, ZOOM_MAX, ZOOM_MIN } from "../../../src/features/application-access/utils/logoCrop.js";

describe("logoCrop", () => {
  test("a wide picture is fitted inside with room around it and centred", () => {
    const { x, y, w, h } = placement({ width: 200, height: 100, size: 100 });
    expect(w).toBeCloseTo(90);
    expect(h).toBeCloseTo(45);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(27.5);
  });

  test("zoom scales around the centre", () => {
    const base = placement({ width: 100, height: 100, size: 100 });
    const zoomed = placement({ width: 100, height: 100, size: 100, zoom: 2 });
    expect(zoomed.w).toBeCloseTo(base.w * 2);
    expect(zoomed.x + zoomed.w / 2).toBeCloseTo(50);
  });

  test("zoom and offset are kept inside their limits", () => {
    expect(placement({ width: 100, height: 100, size: 100, zoom: 99 }).w).toBeCloseTo(90 * ZOOM_MAX);
    expect(placement({ width: 100, height: 100, size: 100, zoom: 0 }).w).toBeCloseTo(90 * ZOOM_MIN);
    expect(placement({ width: 100, height: 100, size: 100, offsetX: 5 }).x).toBeCloseTo(5 + 100);
    expect(clamp(-3, -1, 1)).toBe(-1);
  });

  test("untouched means 100% and no move", () => {
    expect(isUntouched({ zoom: 1, offsetX: 0, offsetY: 0 })).toBe(true);
    expect(isUntouched({ zoom: 1.1, offsetX: 0, offsetY: 0 })).toBe(false);
    expect(isUntouched({ zoom: 1, offsetX: 0.1, offsetY: 0 })).toBe(false);
  });
});
