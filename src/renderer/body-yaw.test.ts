import { describe, expect, it } from "vitest";
import { easeInOut, yawAt } from "./body-yaw";

describe("easeInOut", () => {
  it("pins the endpoints and the midpoint", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
  });

  it("clamps outside [0, 1]", () => {
    expect(easeInOut(-2)).toBe(0);
    expect(easeInOut(3)).toBe(1);
  });

  it("rises monotonically", () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOut(i / 20);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("starts and ends slower than the middle (no snap at either end)", () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });
});

describe("yawAt", () => {
  it("holds the origin at t=0 and lands the target at t=duration", () => {
    expect(yawAt(0, Math.PI / 2, 0, 400)).toBe(0);
    expect(yawAt(0, Math.PI / 2, 400, 400)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("holds the target past the duration", () => {
    expect(yawAt(0, Math.PI / 2, 5000, 400)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("interpolates between the two without overshooting", () => {
    for (let t = 0; t <= 400; t += 20) {
      const v = yawAt(0, Math.PI / 2, t, 400);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(Math.PI / 2);
    }
  });

  it("eases back down when the target is below the origin", () => {
    expect(yawAt(Math.PI / 2, 0, 200, 400)).toBeCloseTo(Math.PI / 4, 10);
  });

  it("lands immediately on a non-positive duration", () => {
    expect(yawAt(1, -1, 0, 0)).toBe(-1);
    expect(yawAt(1, -1, 0, -5)).toBe(-1);
  });
});
