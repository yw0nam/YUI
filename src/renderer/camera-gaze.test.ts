/**
 * Tests for computeGazeGeometry — the pure body-frame gaze geometry.
 *
 * Environment: node (vitest default). three.js math runs headless.
 *
 * Convention under test: three-vrm normalizes every VRM to face -Z, so the body
 * front is the scene's local -Z and both eccentricity and residual are measured in
 * the BODY (scene) frame. The pre-fix code assumed +Z, which put a camera-facing
 * VRM at ~180° eccentricity (permanent disengage) — these tests pin the -Z fix.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { computeGazeGeometry } from "./camera-gaze";

const IDENTITY = new THREE.Quaternion(); // scene unrotated ⇒ body faces world -Z.
const HEAD = new THREE.Vector3(0, 1, 0);

/** Quaternion for a yaw (radians) about +Y — rotates the body's facing. */
function bodyYaw(rad: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rad, 0));
}

describe("computeGazeGeometry", () => {
  it("camera in front of a -Z-facing body (camera at -Z) ⇒ eccentricity ≈ 0", () => {
    const g = computeGazeGeometry(new THREE.Vector3(0, 1, -5), HEAD, IDENTITY);
    expect(g.eccentricityDeg).toBeCloseTo(0, 1);
    expect(g.residualYawDeg).toBeCloseTo(0, 1);
    expect(g.residualPitchDeg).toBeCloseTo(0, 1);
  });

  it("camera behind the body (camera at +Z) ⇒ eccentricity ≈ 180 (regression: +Z would invert this)", () => {
    const g = computeGazeGeometry(new THREE.Vector3(0, 1, 5), HEAD, IDENTITY);
    expect(g.eccentricityDeg).toBeCloseTo(180, 1);
  });

  it("camera above-front ⇒ positive residual pitch, zero yaw", () => {
    const g = computeGazeGeometry(new THREE.Vector3(0, 3, -4), HEAD, IDENTITY);
    expect(g.eccentricityDeg).toBeCloseTo(26.57, 1);
    expect(g.residualYawDeg).toBeCloseTo(0, 1);
    expect(g.residualPitchDeg).toBeCloseTo(26.57, 1);
  });

  it("camera off to each side ⇒ mirrored residual yaw, zero pitch", () => {
    const right = computeGazeGeometry(new THREE.Vector3(3, 1, -4), HEAD, IDENTITY);
    const left = computeGazeGeometry(new THREE.Vector3(-3, 1, -4), HEAD, IDENTITY);
    expect(right.eccentricityDeg).toBeCloseTo(36.87, 1);
    expect(left.eccentricityDeg).toBeCloseTo(36.87, 1);
    expect(right.residualYawDeg).toBeCloseTo(-36.87, 1);
    expect(left.residualYawDeg).toBeCloseTo(36.87, 1);
    expect(right.residualPitchDeg).toBeCloseTo(0, 1);
    expect(left.residualPitchDeg).toBeCloseTo(0, 1);
  });

  it("body frame follows the scene rotation: a 180°-yawed body faces a +Z camera ⇒ eccentricity ≈ 0", () => {
    const g = computeGazeGeometry(new THREE.Vector3(0, 1, 5), HEAD, bodyYaw(Math.PI));
    expect(g.eccentricityDeg).toBeCloseTo(0, 1);
    expect(g.residualYawDeg).toBeCloseTo(0, 1);
    expect(g.residualPitchDeg).toBeCloseTo(0, 1);
  });

  it("residual is body-frame: a yawed body shifts the residual yaw by the body yaw", () => {
    // Camera dead-front in world (-Z), but the body is yawed 30° ⇒ the camera sits
    // 30° off the body front, so the residual yaw reflects the body rotation, not the head.
    const g = computeGazeGeometry(new THREE.Vector3(0, 1, -5), HEAD, bodyYaw((30 * Math.PI) / 180));
    expect(g.eccentricityDeg).toBeCloseTo(30, 1);
    expect(Math.abs(g.residualYawDeg)).toBeCloseTo(30, 1);
  });
});
