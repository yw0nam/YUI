/**
 * Tests for src/renderer/cursor-gaze.ts — the cursor-derived gaze geometry and the
 * stateful apply layer (createCursorGaze).
 *
 * Environment: node (vitest default). three.js math runs headless.
 *
 * Convention under test: three-vrm normalizes every VRM to face -Z, so the body
 * front is the scene's local -Z and both eccentricity and residual are measured in
 * the BODY (scene) frame. The pre-fix code assumed +Z, which put a camera-facing
 * VRM at ~180° eccentricity (permanent disengage) — these tests pin the -Z fix.
 */

import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  computeCursorTarget,
  computeGazeGeometry,
  createCursorGaze,
  cssToNdc,
} from "./cursor-gaze";

const RAD2DEG = 180 / Math.PI;
const IDENTITY = new THREE.Quaternion(); // scene unrotated ⇒ body faces world -Z.
const HEAD = new THREE.Vector3(0, 1, 0);
const noopLog = { error: () => {} };

/** Quaternion for a yaw (radians) about +Y — rotates the body's facing. */
function bodyYaw(rad: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rad, 0));
}

describe("computeGazeGeometry", () => {
  it("target in front of a -Z-facing body (target at -Z) ⇒ eccentricity ≈ 0", () => {
    const g = computeGazeGeometry(new THREE.Vector3(0, 1, -5), HEAD, IDENTITY);
    expect(g.eccentricityDeg).toBeCloseTo(0, 1);
    expect(g.residualYawDeg).toBeCloseTo(0, 1);
    expect(g.residualPitchDeg).toBeCloseTo(0, 1);
  });

  it("target behind the body (target at +Z) ⇒ eccentricity ≈ 180 (regression: +Z would invert this)", () => {
    const g = computeGazeGeometry(new THREE.Vector3(0, 1, 5), HEAD, IDENTITY);
    expect(g.eccentricityDeg).toBeCloseTo(180, 1);
  });

  it("target above-front ⇒ positive residual pitch, zero yaw", () => {
    const g = computeGazeGeometry(new THREE.Vector3(0, 3, -4), HEAD, IDENTITY);
    expect(g.eccentricityDeg).toBeCloseTo(26.57, 1);
    expect(g.residualYawDeg).toBeCloseTo(0, 1);
    expect(g.residualPitchDeg).toBeCloseTo(26.57, 1);
  });

  it("target off to each side ⇒ mirrored residual yaw, zero pitch", () => {
    const right = computeGazeGeometry(new THREE.Vector3(3, 1, -4), HEAD, IDENTITY);
    const left = computeGazeGeometry(new THREE.Vector3(-3, 1, -4), HEAD, IDENTITY);
    expect(right.eccentricityDeg).toBeCloseTo(36.87, 1);
    expect(left.eccentricityDeg).toBeCloseTo(36.87, 1);
    expect(right.residualYawDeg).toBeCloseTo(-36.87, 1);
    expect(left.residualYawDeg).toBeCloseTo(36.87, 1);
    expect(right.residualPitchDeg).toBeCloseTo(0, 1);
    expect(left.residualPitchDeg).toBeCloseTo(0, 1);
  });

  it("body frame follows the scene rotation: a 180°-yawed body faces a +Z target ⇒ eccentricity ≈ 0", () => {
    const g = computeGazeGeometry(new THREE.Vector3(0, 1, 5), HEAD, bodyYaw(Math.PI));
    expect(g.eccentricityDeg).toBeCloseTo(0, 1);
    expect(g.residualYawDeg).toBeCloseTo(0, 1);
    expect(g.residualPitchDeg).toBeCloseTo(0, 1);
  });

  it("residual is body-frame: a yawed body shifts the residual yaw by the body yaw", () => {
    // Target dead-front in world (-Z), but the body is yawed 30° ⇒ the target sits
    // 30° off the body front, so the residual yaw reflects the body rotation, not the head.
    const g = computeGazeGeometry(new THREE.Vector3(0, 1, -5), HEAD, bodyYaw((30 * Math.PI) / 180));
    expect(g.eccentricityDeg).toBeCloseTo(30, 1);
    expect(Math.abs(g.residualYawDeg)).toBeCloseTo(30, 1);
  });
});

describe("cssToNdc", () => {
  it("window center maps to NDC origin", () => {
    const p = cssToNdc(400, 300, 800, 600);
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.y).toBeCloseTo(0, 10);
  });

  it("top-left corner maps to (-1, 1)", () => {
    expect(cssToNdc(0, 0, 800, 600)).toEqual({ x: -1, y: 1 });
  });

  it("bottom-right corner maps to (1, -1)", () => {
    expect(cssToNdc(800, 600, 800, 600)).toEqual({ x: 1, y: -1 });
  });

  it("outside the window produces values outside [-1, 1] (expected/valid)", () => {
    const p = cssToNdc(1200, -100, 800, 600);
    expect(p.x).toBeGreaterThan(1);
    expect(p.y).toBeGreaterThan(1);
  });
});

describe("computeCursorTarget", () => {
  it("places the target at half the camera-head distance along dir", () => {
    const cameraPos = new THREE.Vector3(0, 0, 0);
    const headPos = new THREE.Vector3(0, 0, 10);
    const dir = new THREE.Vector3(0, 0, 1);
    const out = new THREE.Vector3();
    const usable = computeCursorTarget(cameraPos, dir, headPos, out);
    expect(usable).toBe(true);
    expect(out.distanceTo(cameraPos)).toBeCloseTo(5, 5);
  });

  it("never lands within epsilon of the head, even aimed straight at it", () => {
    const cameraPos = new THREE.Vector3(0, 0, 0);
    const headPos = new THREE.Vector3(0, 0, 10);
    const dir = new THREE.Vector3(0, 0, 1); // straight at the head
    const out = new THREE.Vector3();
    computeCursorTarget(cameraPos, dir, headPos, out);
    expect(out.distanceTo(headPos)).toBeGreaterThan(4); // half-distance = 5, well clear
  });

  it("flags unusable when the camera sits at the head (degenerate zero distance)", () => {
    const cameraPos = new THREE.Vector3(1, 2, 3);
    const headPos = new THREE.Vector3(1, 2, 3);
    const dir = new THREE.Vector3(0, 0, 1);
    const out = new THREE.Vector3();
    expect(computeCursorTarget(cameraPos, dir, headPos, out)).toBe(false);
  });
});

// ─── createCursorGaze — step() apply layer ────────────────────────────────────

interface Fixture {
  vrm: VRM;
  head: THREE.Object3D;
  neck: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
}

/** Head/neck bones on an unrotated scene (body faces world -Z) + a camera looking at the head. */
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
  it("a cursor well off-center drives head/neck rotation and lookAt yaw/pitch", () => {
    const { vrm, head, neck, camera } = makeFixture();
    const gaze = createCursorGaze({
      camera,
      getVrm: () => vrm,
      log: noopLog,
      mountWidth: () => 800,
      mountHeight: () => 600,
    });
    gaze.onVrmLoaded(vrm);
    gaze.setCursorCss({ x: 799, y: 1 }); // top-right corner — well off-center

    for (let i = 0; i < 120; i++) {
      head.quaternion.identity();
      neck.quaternion.identity();
      gaze.step(0.05);
    }

    expect(quaternionAngleDeg(head.quaternion)).toBeGreaterThan(0.5);
    expect(quaternionAngleDeg(neck.quaternion)).toBeGreaterThan(0.5);
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
    gaze.setCursorCss({ x: 799, y: 1 });
    for (let i = 0; i < 120; i++) {
      head.quaternion.identity();
      gaze.step(0.05);
    }
    const engagedAngle = quaternionAngleDeg(head.quaternion);
    expect(engagedAngle).toBeGreaterThan(0.5);

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
    gaze.setCursorCss({ x: 799, y: 1 });
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
