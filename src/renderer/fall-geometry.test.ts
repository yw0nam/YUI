/**
 * fall-geometry.test.ts — TDD red phase.
 *
 * Pins the contract for the perched-character fall math. Pure arithmetic only
 * (no three.js / DOM), so this runs in vitest node env. clampToWorkArea mirrors
 * the Rust `clamp_to_work_area` (drag.rs); cases below match its unit tests.
 *
 * All values are logical px / points.
 */

import { describe, it, expect } from "vitest";
import { clampToWorkArea, computeTargetY } from "./fall-geometry";

const FULL = { x: 0, y: 0, width: 2560, height: 1440 };

describe("clampToWorkArea", () => {
  it("is a no-op when the window is fully inside", () => {
    const r = clampToWorkArea(100, 100, 400, 600, FULL);
    expect(r.x).toBeCloseTo(100, 9);
    expect(r.y).toBeCloseTo(100, 9);
  });

  it("clamps an off-left x to the work-area left edge", () => {
    const r = clampToWorkArea(-50, 100, 400, 600, FULL);
    expect(r.x).toBeCloseTo(0, 9);
  });

  it("clamps an off-right x so the window stays inside", () => {
    const r = clampToWorkArea(2400, 100, 400, 600, FULL);
    expect(r.x).toBeCloseTo(2160, 9);
  });

  it("clamps an off-top y to the work-area top edge", () => {
    const r = clampToWorkArea(100, -10, 400, 600, FULL);
    expect(r.y).toBeCloseTo(0, 9);
  });

  it("clamps an off-bottom y so the window stays inside", () => {
    const r = clampToWorkArea(100, 1000, 400, 600, FULL);
    expect(r.y).toBeCloseTo(840, 9);
  });

  it("replicates the literal Rust order when the window is larger than the area", () => {
    // Rust: x.max(work_x).min(work_x + work_w - w). When w > work_w the min bound
    // (work_x + work_w - w) is < work_x, so the result is that smaller value — it
    // does NOT pin to the top-left. Window 3000×2000 in a 2560×1440 area at origin.
    const r = clampToWorkArea(100, 100, 3000, 2000, FULL);
    expect(r.x).toBeCloseTo(2560 - 3000, 9); // -440
    expect(r.y).toBeCloseTo(1440 - 2000, 9); // -560
  });

  it("respects a non-zero (secondary monitor) work origin", () => {
    const area = { x: 1920, y: 0, width: 1920, height: 1080 };
    const r = clampToWorkArea(1800, 50, 400, 600, area);
    expect(r.x).toBeCloseTo(1920, 9);
    expect(r.y).toBeCloseTo(50, 9);
  });

  it("respects a genuinely negative (secondary-monitor-left) work origin", () => {
    const area = { x: -1920, y: 0, width: 1920, height: 1080 };
    // x off the left of the negative-origin area clamps up to area.x.
    const r = clampToWorkArea(-2000, 50, 400, 600, area);
    expect(r.x).toBeCloseTo(-1920, 9);
    expect(r.y).toBeCloseTo(50, 9);
  });
});

describe("computeTargetY", () => {
  // Work area 0..1080 vertically; workBottom = 1080.
  const AREA = { x: 0, y: 0, width: 1920, height: 1080 };

  it("computes a positive fall distance when the window is above the landing", () => {
    // feet 700px below window top → raw target 1080-700 = 380; winH 400 keeps it
    // unclamped (workBottom - winH = 680 ≥ 380). winY 100 ⇒ dist 280.
    const r = computeTargetY({ winY: 100, winH: 400, feetPxFromWindowTop: 700, workArea: AREA });
    expect(r.skipFall).toBe(false);
    expect(r.targetWinY).toBeCloseTo(380, 9);
    expect(r.distance).toBeCloseTo(280, 9);
  });

  it("lands the feet on the work-area bottom (targetWinY == workBottom - feet) when unclamped", () => {
    const feet = 650;
    const r = computeTargetY({ winY: 50, winH: 400, feetPxFromWindowTop: feet, workArea: AREA });
    expect(r.targetWinY).toBeCloseTo(1080 - feet, 9); // 430
  });

  it("skips the fall when already at/below the landing (distance <= 0)", () => {
    // raw target = 1080-700 = 380 (unclamped at winH 400); winY 380 ⇒ distance 0 ⇒ skip.
    const at = computeTargetY({ winY: 380, winH: 400, feetPxFromWindowTop: 700, workArea: AREA });
    expect(at.distance).toBeCloseTo(0, 9);
    expect(at.skipFall).toBe(true);
    // winY below the landing ⇒ negative distance ⇒ skip.
    const below = computeTargetY({ winY: 500, winH: 400, feetPxFromWindowTop: 700, workArea: AREA });
    expect(below.distance).toBeLessThan(0);
    expect(below.skipFall).toBe(true);
  });

  it("clamps the target up to workArea.y when raw target is above the work area", () => {
    // feet huge ⇒ raw target 1080-2000 = -920 < workArea.y(0) ⇒ clamp to 0.
    const r = computeTargetY({ winY: -1000, winH: 800, feetPxFromWindowTop: 2000, workArea: AREA });
    expect(r.targetWinY).toBeCloseTo(0, 9);
    expect(r.distance).toBeCloseTo(0 - -1000, 9); // 1000
  });

  it("clamps the target down to workBottom - winH when raw target sits too low", () => {
    // feet 0 ⇒ raw target 1080; workBottom - winH = 1080-800 = 280 < 1080 ⇒ clamp to 280.
    const r = computeTargetY({ winY: 50, winH: 800, feetPxFromWindowTop: 0, workArea: AREA });
    expect(r.targetWinY).toBeCloseTo(280, 9);
    expect(r.distance).toBeCloseTo(230, 9); // 280 - 50
  });
});
