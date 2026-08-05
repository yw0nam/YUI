/**
 * Tests for src/renderer/cursor-gaze.ts — the cursor screen-offset → residual mapping and
 * the stateful apply layer (createCursorGaze).
 *
 * Environment: node (vitest default). three.js math runs headless.
 */

import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCursorGaze, cursorToResidual } from "./cursor-gaze";

const RAD2DEG = 180 / Math.PI;
const noopLog = { error: () => {} };
const HEAD_CSS = { x: 400, y: 300 };
const MOUNT_WIDTH = 800;

describe("cursorToResidual", () => {
  it("cursor on the head ⇒ zero residual and eccentricity", () => {
    const r = cursorToResidual(HEAD_CSS, HEAD_CSS, MOUNT_WIDTH, 30);
    expect(r.residualYawDeg).toBeCloseTo(0, 10);
    expect(r.residualPitchDeg).toBeCloseTo(0, 10);
    expect(r.eccentricityDeg).toBeCloseTo(0, 10);
  });

  it("cursor right of the head ⇒ positive yaw scaled by offset/width × sensitivity", () => {
    const r = cursorToResidual({ x: 480, y: 300 }, HEAD_CSS, MOUNT_WIDTH, 30);
    // dx = 80 ⇒ 80/800 = 0.1 ⇒ 0.1 × 30 = 3.
    expect(r.residualYawDeg).toBeCloseTo(3, 5);
    expect(r.residualPitchDeg).toBeCloseTo(0, 5);
  });

  it("cursor left of the head ⇒ negative yaw", () => {
    const r = cursorToResidual({ x: 320, y: 300 }, HEAD_CSS, MOUNT_WIDTH, 30);
    expect(r.residualYawDeg).toBeCloseTo(-3, 5);
  });

  it("cursor above the head (smaller CSS y) ⇒ positive pitch", () => {
    const r = cursorToResidual({ x: 400, y: 220 }, HEAD_CSS, MOUNT_WIDTH, 30);
    expect(r.residualPitchDeg).toBeCloseTo(3, 5);
    expect(r.residualYawDeg).toBeCloseTo(0, 5);
  });

  it("cursor below the head ⇒ negative pitch", () => {
    const r = cursorToResidual({ x: 400, y: 380 }, HEAD_CSS, MOUNT_WIDTH, 30);
    expect(r.residualPitchDeg).toBeCloseTo(-3, 5);
  });

  it("scales linearly with sensitivity", () => {
    const low = cursorToResidual({ x: 480, y: 300 }, HEAD_CSS, MOUNT_WIDTH, 10);
    const high = cursorToResidual({ x: 480, y: 300 }, HEAD_CSS, MOUNT_WIDTH, 60);
    expect(low.residualYawDeg).toBeCloseTo(1, 5);
    expect(high.residualYawDeg).toBeCloseTo(6, 5);
  });

  it("eccentricity below the clamp equals the raw vector magnitude", () => {
    const r = cursorToResidual({ x: 480, y: 300 }, HEAD_CSS, MOUNT_WIDTH, 30);
    expect(r.eccentricityDeg).toBeCloseTo(3, 5);
  });

  it("clamps the (yaw, pitch) vector to 40°, scaling both components together", () => {
    // dx = dy = 400 ⇒ nx = ny = 0.5 ⇒ pre-clamp yaw = 30, pitch = -30 (magnitude ≈ 42.4 > 40).
    const r = cursorToResidual({ x: 800, y: 700 }, HEAD_CSS, MOUNT_WIDTH, 60);
    const mag = Math.hypot(r.residualYawDeg, r.residualPitchDeg);
    expect(mag).toBeCloseTo(40, 5);
    expect(r.eccentricityDeg).toBeCloseTo(40, 5);
    // Direction preserved: yaw and pitch keep their pre-clamp ratio (equal magnitude, opposite sign).
    expect(r.residualYawDeg).toBeCloseTo(-r.residualPitchDeg, 5);
  });
});

// ─── createCursorGaze — step() apply layer ────────────────────────────────────

interface Fixture {
  vrm: VRM;
  head: THREE.Object3D;
  neck: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
}

/** Head/neck bones on an unrotated scene + a camera looking straight at the head. */
function makeFixture(headPos = new THREE.Vector3(0, 1.5, 0)): Fixture {
  const scene = new THREE.Group();
  const head = new THREE.Object3D();
  head.position.copy(headPos);
  const neck = new THREE.Object3D();
  scene.add(neck);
  scene.add(head);

  const lookAt = { autoUpdate: true, yaw: 0, pitch: 0 };
  const vrm = {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name: string) =>
        name === "head" ? head : name === "neck" ? neck : null,
    },
    lookAt,
  } as unknown as VRM;

  const camera = new THREE.PerspectiveCamera(90, 800 / 600, 0.1, 100);
  camera.position.set(0, 1.5, -1.2);
  camera.lookAt(headPos);
  camera.updateMatrixWorld(true);

  return { vrm, head, neck, camera };
}

function quaternionAngleDeg(q: THREE.Quaternion): number {
  return q.angleTo(new THREE.Quaternion()) * RAD2DEG;
}

describe("createCursorGaze — step()", () => {
  it("a cursor at the window corner drives a large settled head+neck rotation and lookAt yaw/pitch", () => {
    const { vrm, head, neck, camera } = makeFixture();
    const gaze = createCursorGaze({
      camera,
      getVrm: () => vrm,
      log: noopLog,
      mountWidth: () => 800,
      mountHeight: () => 600,
    });
    gaze.onVrmLoaded(vrm);
    gaze.setCursorCss({ x: 2000, y: -900 }); // beyond the top-right corner

    for (let i = 0; i < 120; i++) {
      head.quaternion.identity();
      neck.quaternion.identity();
      gaze.step(0.05);
    }

    const total = quaternionAngleDeg(head.quaternion) + quaternionAngleDeg(neck.quaternion);
    expect(total).toBeGreaterThan(10);
    expect(vrm.lookAt!.yaw !== 0 || vrm.lookAt!.pitch !== 0).toBe(true);
  });

  it("cursor null eases the damped state back toward neutral instead of snapping", () => {
    const { vrm, head, camera } = makeFixture();
    const gaze = createCursorGaze({
      camera,
      getVrm: () => vrm,
      log: noopLog,
      mountWidth: () => 800,
      mountHeight: () => 600,
    });
    gaze.onVrmLoaded(vrm);
    gaze.setCursorCss({ x: 2000, y: -900 });
    for (let i = 0; i < 120; i++) {
      head.quaternion.identity();
      gaze.step(0.05);
    }
    const engagedAngle = quaternionAngleDeg(head.quaternion);
    expect(engagedAngle).toBeGreaterThan(5);

    gaze.setCursorCss(null);
    head.quaternion.identity();
    gaze.step(0.05);
    const easingAngle = quaternionAngleDeg(head.quaternion);

    expect(easingAngle).toBeGreaterThan(0);
    expect(easingAngle).toBeLessThan(engagedAngle);
    expect(gaze.isConverging()).toBe(true);
  });

  it("disabled tracking eases back toward neutral like a null cursor", () => {
    const { vrm, head, camera } = makeFixture();
    const gaze = createCursorGaze({
      camera,
      getVrm: () => vrm,
      log: noopLog,
      mountWidth: () => 800,
      mountHeight: () => 600,
    });
    gaze.onVrmLoaded(vrm);
    gaze.setCursorCss({ x: 2000, y: -900 });
    for (let i = 0; i < 120; i++) {
      head.quaternion.identity();
      gaze.step(0.05);
    }
    const engagedAngle = quaternionAngleDeg(head.quaternion);

    gaze.setEnabled(false);
    head.quaternion.identity();
    gaze.step(0.05);
    const easingAngle = quaternionAngleDeg(head.quaternion);

    expect(easingAngle).toBeLessThan(engagedAngle);
  });

  it("a held neutral gaze makes no bone writes (settled no-op)", () => {
    const { vrm, head, neck, camera } = makeFixture();
    const gaze = createCursorGaze({
      camera,
      getVrm: () => vrm,
      log: noopLog,
      mountWidth: () => 800,
      mountHeight: () => 600,
    });
    gaze.onVrmLoaded(vrm);
    // Cursor never set (stays null) ⇒ never trackable ⇒ already at neutral from load.
    gaze.step(1);
    expect(head.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(neck.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(gaze.isConverging()).toBe(false);
  });
});
