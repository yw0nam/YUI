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
import { clampToWorkArea } from "./fall-geometry";

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
