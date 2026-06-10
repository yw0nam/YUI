/**
 * perch-geometry.test.ts — TDD red phase.
 *
 * Pins the contract for the "window-sit drop" perch math. All pure functions:
 * THREE camera/projection + plain arithmetic, so this runs in vitest node env
 * (same pattern as project-anchor.test.ts).
 *
 * Fixture camera mirrors a realistic framing: PerspectiveCamera(fov 30, aspect 1)
 * at (0, 1.3, 3) looking at (0, 1.3, 0), canvas 800×1200.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  projectToScreen,
  seatAnchorWorld,
  seatAnchorWorldInto,
  characterScreenHeight,
  petPxToGlobalPoints,
  inCatchZone,
  worldYPerPixel,
  seatOffsetWorldY,
  CATCH_U,
  CATCH_D,
  CATCH_MX,
  SEAT_DROP_DEFAULT,
} from "./perch-geometry";

const CANVAS_W = 800;
const CANVAS_H = 1200;

/** Build the fixture camera at (0,1.3,3) looking at (0,1.3,0). */
function fixtureCamera(zoom = 1): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  // zoom > 1 = closer = bigger on screen. Look-at point fixed at (0,1.3,0).
  const dist = 3 / zoom;
  cam.position.set(0, 1.3, dist);
  cam.lookAt(0, 1.3, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

describe("perch-geometry — exported tunables", () => {
  it("locks the catch-zone constants and seat drop default", () => {
    expect(CATCH_U).toBe(0.28);
    expect(CATCH_D).toBe(0.23);
    expect(CATCH_MX).toBe(0.0);
    expect(SEAT_DROP_DEFAULT).toBe(0.0);
  });
});

describe("projectToScreen", () => {
  it("projects the look-at target to ~canvas center", () => {
    const cam = fixtureCamera();
    const p = projectToScreen(new THREE.Vector3(0, 1.3, 0), cam, CANVAS_W, CANVAS_H)!;
    expect(p).not.toBeNull();
    expect(p.x).toBeCloseTo(CANVAS_W / 2, 3);
    expect(p.y).toBeCloseTo(CANVAS_H / 2, 3);
  });

  it("a higher-Y world point projects to a smaller screen-y (top) than a lower one", () => {
    const cam = fixtureCamera();
    const high = projectToScreen(new THREE.Vector3(0, 1.6, 0), cam, CANVAS_W, CANVAS_H)!;
    const low = projectToScreen(new THREE.Vector3(0, 1.0, 0), cam, CANVAS_W, CANVAS_H)!;
    expect(high.y).toBeLessThan(low.y);
  });

  it("returns null for a non-finite projection (point at the camera eye)", () => {
    const cam = fixtureCamera();
    // A point coincident with the camera position has w≈0 ⇒ non-finite NDC.
    const p = projectToScreen(cam.position.clone(), cam, CANVAS_W, CANVAS_H);
    expect(p).toBeNull();
  });
});

describe("seatAnchorWorld", () => {
  it("drops the seat below the hip by seatDrop on Y only", () => {
    const hips = new THREE.Vector3(0.2, 1.0, -0.3);
    const seat = seatAnchorWorld(hips, 0.15);
    expect(seat.x).toBeCloseTo(0.2, 6);
    expect(seat.y).toBeCloseTo(0.85, 6);
    expect(seat.z).toBeCloseTo(-0.3, 6);
  });

  it("seatDrop of 0 returns the hip point unchanged", () => {
    const hips = new THREE.Vector3(1, 2, 3);
    const seat = seatAnchorWorld(hips, SEAT_DROP_DEFAULT);
    expect(seat.x).toBeCloseTo(1, 6);
    expect(seat.y).toBeCloseTo(2, 6);
    expect(seat.z).toBeCloseTo(3, 6);
  });

  it("returns a fresh vector (does not alias the hips input)", () => {
    const hips = new THREE.Vector3(0.2, 1.0, -0.3);
    const seat = seatAnchorWorld(hips, 0.15);
    expect(seat).not.toBe(hips);
    expect(hips.y).toBeCloseTo(1.0, 6); // input untouched
  });
});

describe("seatAnchorWorldInto", () => {
  it("writes into out (same reference returned) and computes y = hips.y - drop", () => {
    const out = new THREE.Vector3(99, 99, 99);
    const hips = new THREE.Vector3(0.2, 1.0, -0.3);
    const ret = seatAnchorWorldInto(out, hips, 0.15);
    expect(ret).toBe(out); // returns the provided out
    expect(out.x).toBeCloseTo(0.2, 6);
    expect(out.y).toBeCloseTo(0.85, 6); // 1.0 - 0.15
    expect(out.z).toBeCloseTo(-0.3, 6);
  });

  it("does not mutate the hips input", () => {
    const out = new THREE.Vector3();
    const hips = new THREE.Vector3(1, 2, 3);
    seatAnchorWorldInto(out, hips, 0.5);
    expect(hips.x).toBeCloseTo(1, 6);
    expect(hips.y).toBeCloseTo(2, 6);
    expect(hips.z).toBeCloseTo(3, 6);
  });

  it("matches seatAnchorWorld for the same inputs", () => {
    const hips = new THREE.Vector3(-0.4, 1.7, 0.9);
    const fresh = seatAnchorWorld(hips, 0.2);
    const out = seatAnchorWorldInto(new THREE.Vector3(), hips, 0.2);
    expect(out.x).toBeCloseTo(fresh.x, 9);
    expect(out.y).toBeCloseTo(fresh.y, 9);
    expect(out.z).toBeCloseTo(fresh.z, 9);
  });
});

describe("characterScreenHeight", () => {
  it("is positive for a head above the feet", () => {
    const cam = fixtureCamera();
    const head = new THREE.Vector3(0, 1.6, 0);
    const feet = new THREE.Vector3(0, 0.0, 0);
    const h = characterScreenHeight(head, feet, cam, CANVAS_W, CANVAS_H)!;
    expect(h).not.toBeNull();
    expect(h).toBeGreaterThan(0);
  });

  it("scales up when the camera moves closer (bigger on screen)", () => {
    const head = new THREE.Vector3(0, 1.6, 0);
    const feet = new THREE.Vector3(0, 0.0, 0);
    const far = characterScreenHeight(head, feet, fixtureCamera(1), CANVAS_W, CANVAS_H)!;
    const near = characterScreenHeight(head, feet, fixtureCamera(1.6), CANVAS_W, CANVAS_H)!;
    expect(near).toBeGreaterThan(far);
  });

  it("returns null when either projection is null", () => {
    const cam = fixtureCamera();
    const atEye = cam.position.clone();
    const feet = new THREE.Vector3(0, 0, 0);
    expect(characterScreenHeight(atEye, feet, cam, CANVAS_W, CANVAS_H)).toBeNull();
    expect(characterScreenHeight(feet, atEye, cam, CANVAS_W, CANVAS_H)).toBeNull();
  });
});

describe("petPxToGlobalPoints", () => {
  it("divides physical outer position by scaleFactor then adds pet px", () => {
    const g = petPxToGlobalPoints({ x: 40, y: 25 }, { x: 2000, y: 1000 }, 2);
    // (2000/2 + 40, 1000/2 + 25) = (1040, 525)
    expect(g.x).toBeCloseTo(1040, 6);
    expect(g.y).toBeCloseTo(525, 6);
  });

  it("scaleFactor 1 is identity on the outer position", () => {
    const g = petPxToGlobalPoints({ x: 10, y: 20 }, { x: 300, y: 400 }, 1);
    expect(g.x).toBeCloseTo(310, 6);
    expect(g.y).toBeCloseTo(420, 6);
  });

  it("guards scaleFactor <= 0 by treating it as 1 (no divide-by-zero / sign flip)", () => {
    const g0 = petPxToGlobalPoints({ x: 5, y: 5 }, { x: 200, y: 100 }, 0);
    expect(Number.isFinite(g0.x)).toBe(true);
    expect(Number.isFinite(g0.y)).toBe(true);
    expect(g0.x).toBeCloseTo(205, 6);
    expect(g0.y).toBeCloseTo(105, 6);
  });
});

describe("inCatchZone", () => {
  // win rect in points; charH=200 ⇒ U band = 0.28*200 = 56px, D band = 0.23*200 = 46px.
  const WIN = { x: 300, y: 400, width: 520, height: 320 };
  const CHAR_H = 200;
  const U_BAND = CATCH_U * CHAR_H; // 56
  const D_BAND = CATCH_D * CHAR_H; // 46
  // Vertical band: [win.y - 56, win.y + 46] = [344, 446].
  // Horizontal band (mx=0): [win.x, win.x + width] = [300, 820].
  const cx = WIN.x + WIN.width / 2; // 560, comfortably inside horizontally

  it("accepts a point centered inside the band", () => {
    expect(inCatchZone({ x: cx, y: WIN.y }, WIN, CHAR_H)).toBe(true);
  });

  it("U boundary: just inside accepted, just outside (too high) rejected", () => {
    const topInside = WIN.y - U_BAND + 1; // 345
    const topOutside = WIN.y - U_BAND - 1; // 343
    expect(inCatchZone({ x: cx, y: topInside }, WIN, CHAR_H)).toBe(true);
    expect(inCatchZone({ x: cx, y: topOutside }, WIN, CHAR_H)).toBe(false);
  });

  it("D boundary: just inside accepted, just outside (too low) rejected", () => {
    const botInside = WIN.y + D_BAND - 1; // 445
    const botOutside = WIN.y + D_BAND + 1; // 447
    expect(inCatchZone({ x: cx, y: botInside }, WIN, CHAR_H)).toBe(true);
    expect(inCatchZone({ x: cx, y: botOutside }, WIN, CHAR_H)).toBe(false);
  });

  it("horizontal width with mx=0 is strict to the window edges", () => {
    const yMid = WIN.y; // inside vertical band
    expect(inCatchZone({ x: WIN.x + 1, y: yMid }, WIN, CHAR_H)).toBe(true);
    expect(inCatchZone({ x: WIN.x - 1, y: yMid }, WIN, CHAR_H)).toBe(false);
    expect(inCatchZone({ x: WIN.x + WIN.width - 1, y: yMid }, WIN, CHAR_H)).toBe(true);
    expect(inCatchZone({ x: WIN.x + WIN.width + 1, y: yMid }, WIN, CHAR_H)).toBe(false);
  });

  it("mx opt widens the horizontal band by mx*width on each side", () => {
    const yMid = WIN.y;
    const mx = 0.1; // 52px each side
    // Just outside the strict edge, but inside the widened band.
    expect(inCatchZone({ x: WIN.x - 10, y: yMid }, WIN, CHAR_H, { mx })).toBe(true);
    // Beyond the widened band.
    expect(inCatchZone({ x: WIN.x - (mx * WIN.width) - 1, y: yMid }, WIN, CHAR_H, { mx })).toBe(false);
  });

  it("u/d opts override the default vertical bands", () => {
    // Tighter u: a point 50px above the top is now outside (band = 0.1*200 = 20).
    expect(inCatchZone({ x: cx, y: WIN.y - 50 }, WIN, CHAR_H, { u: 0.1 })).toBe(false);
    // Wider d: a point 80px below the top is now inside (band = 0.5*200 = 100).
    expect(inCatchZone({ x: cx, y: WIN.y + 80 }, WIN, CHAR_H, { d: 0.5 })).toBe(true);
  });
});

describe("worldYPerPixel", () => {
  it("is positive", () => {
    const cam = fixtureCamera();
    const wpp = worldYPerPixel(cam, 3, CANVAS_H);
    expect(wpp).toBeGreaterThan(0);
  });

  it("is larger at greater depth (further = each pixel spans more world)", () => {
    const cam = fixtureCamera();
    const near = worldYPerPixel(cam, 2, CANVAS_H);
    const far = worldYPerPixel(cam, 5, CANVAS_H);
    expect(far).toBeGreaterThan(near);
  });

  it("matches the perspective formula", () => {
    const cam = fixtureCamera();
    const depth = 3;
    const expected =
      (2 * depth * Math.tan(((cam.fov * Math.PI) / 180) / 2)) / CANVAS_H;
    expect(worldYPerPixel(cam, depth, CANVAS_H)).toBeCloseTo(expected, 9);
  });

  // The pin path feeds view-axis depth (seat−eye projected onto camera forward),
  // NOT Euclidean distance. For an off-center seat the two diverge; this pins the
  // expectation that callers compute on-axis depth before calling worldYPerPixel.
  it("on-axis depth (forward dot) is smaller than Euclidean for an off-center seat", () => {
    const cam = fixtureCamera(); // at (0,1.3,3) looking toward -Z
    // Seat well off the view axis (large +x) at the same world-Z plane as look-at.
    const seat = new THREE.Vector3(2.0, 1.3, 0);
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    const rel = seat.clone().sub(cam.position);
    const viewDepth = rel.dot(forward); // on-axis depth
    const euclid = cam.position.distanceTo(seat); // overestimate
    expect(viewDepth).toBeGreaterThan(0);
    expect(euclid).toBeGreaterThan(viewDepth);
    // worldYPerPixel scales linearly with depth, so the Euclidean feed inflates it.
    expect(worldYPerPixel(cam, euclid, CANVAS_H)).toBeGreaterThan(
      worldYPerPixel(cam, viewDepth, CANVAS_H),
    );
  });
});

describe("seatOffsetWorldY", () => {
  it("moving the seat UP on screen (smaller targetScreenY) ⇒ positive Δworld", () => {
    const seatY = 800; // current screen-y
    const targetY = 500; // higher on screen (smaller y)
    const wpp = 0.001;
    const delta = seatOffsetWorldY(seatY, targetY, wpp);
    expect(delta).toBeGreaterThan(0);
  });

  it("moving the seat DOWN on screen (larger targetScreenY) ⇒ negative Δworld", () => {
    const delta = seatOffsetWorldY(500, 800, 0.001);
    expect(delta).toBeLessThan(0);
  });

  it("magnitude equals |delta_px| * worldYPerPixel", () => {
    const seatY = 800;
    const targetY = 500;
    const wpp = 0.002;
    const delta = seatOffsetWorldY(seatY, targetY, wpp);
    expect(Math.abs(delta)).toBeCloseTo(Math.abs(targetY - seatY) * wpp, 9);
    // Exact signed value: -(500 - 800) * 0.002 = +0.6
    expect(delta).toBeCloseTo(0.6, 9);
  });

  it("zero delta when target equals current", () => {
    expect(seatOffsetWorldY(640, 640, 0.001)).toBeCloseTo(0, 12);
  });
});
