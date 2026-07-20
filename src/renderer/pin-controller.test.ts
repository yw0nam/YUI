/**
 * pin-controller.test.ts — stateful perch/peek application.
 *
 * Pins lifecycle, mutual exclusion, convergence, and scene-position writes
 * against stub VRMs and a headless three.js camera.
 */

import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import { createPinController } from "./pin-controller";

function createFixture() {
  const hips = new THREE.Object3D();
  const scene = new THREE.Object3D();
  scene.add(hips);
  const vrm = {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name: string) => (name === "hips" ? hips : null),
    },
  } as unknown as VRM;
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies Logger;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const mountWidth = vi.fn(() => 100);
  const mountHeight = vi.fn(() => 100);
  const pins = createPinController({ log, mountWidth, mountHeight });
  pins.onVrmLoaded(vrm);
  scene.updateWorldMatrix(true, true);
  return { camera, hips, log, mountHeight, mountWidth, pins, scene, vrm };
}

describe("createPinController — state and conflicts", () => {
  it("reports perch transitions only when set state changes", () => {
    const { pins } = createFixture();

    expect(pins.setPerchTarget({ edgeLocalYpx: 25 })).toBe(true);
    expect(pins.isPerched()).toBe(true);
    expect(pins.setPerchTarget({ edgeLocalYpx: 20 })).toBe(false);
    expect(pins.setPerchTarget(null)).toBe(true);
    expect(pins.isPerched()).toBe(false);
    expect(pins.setPerchTarget(null)).toBe(false);
  });

  it("reports peek transitions only when set state changes", () => {
    const { pins } = createFixture();

    expect(pins.setPeekTarget({ targetXpx: 75 })).toBe(true);
    expect(pins.isPeeking()).toBe(true);
    expect(pins.setPeekTarget({ targetXpx: 80 })).toBe(false);
    expect(pins.setPeekTarget(null)).toBe(true);
    expect(pins.isPeeking()).toBe(false);
    expect(pins.setPeekTarget(null)).toBe(false);
  });

  it("keeps the active pin when the other pin is requested", () => {
    const { log, pins } = createFixture();
    pins.setPeekTarget({ targetXpx: 75 });

    expect(pins.setPerchTarget({ edgeLocalYpx: 25 })).toBe(false);
    expect(pins.isPeeking()).toBe(true);
    expect(pins.isPerched()).toBe(false);
    expect(log.warn).toHaveBeenCalledWith("perch_pin_conflict", {
      active: "peek",
      requested: "perch",
    });
    expect(log.warn).toHaveBeenCalledTimes(1);

    pins.setPeekTarget(null);
    log.warn.mockClear();
    pins.setPerchTarget({ edgeLocalYpx: 25 });

    expect(pins.setPeekTarget({ targetXpx: 75 })).toBe(false);
    expect(pins.isPerched()).toBe(true);
    expect(pins.isPeeking()).toBe(false);
    expect(log.warn).toHaveBeenCalledWith("perch_pin_conflict", {
      active: "perch",
      requested: "peek",
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("updates active numeric targets even when the state does not change", () => {
    const { camera, pins, scene } = createFixture();
    pins.setPerchTarget({ edgeLocalYpx: 10 });
    pins.step(camera);
    const firstY = scene.position.y;

    expect(pins.setPerchTarget({ edgeLocalYpx: 90 })).toBe(false);
    pins.step(camera);

    expect(scene.position.y).toBeLessThan(firstY);

    pins.setPerchTarget(null);
    pins.setPeekTarget({ targetXpx: 10 });
    pins.step(camera);
    const firstX = scene.position.x;

    expect(pins.setPeekTarget({ targetXpx: 90 })).toBe(false);
    pins.step(camera);

    expect(scene.position.x).toBeGreaterThan(firstX);
  });
});

describe("createPinController — stepping", () => {
  it("tracks convergence while either pin approaches its target", () => {
    const { camera, pins } = createFixture();
    pins.setPerchTarget({ edgeLocalYpx: 10 });
    pins.step(camera);
    expect(pins.isConverging()).toBe(true);

    for (let i = 0; i < 20; i += 1) pins.step(camera);
    expect(pins.isConverging()).toBe(false);

    pins.setPerchTarget(null);
    pins.setPeekTarget({ targetXpx: 90 });
    pins.step(camera);
    expect(pins.isConverging()).toBe(true);

    for (let i = 0; i < 20; i += 1) pins.step(camera);
    expect(pins.isConverging()).toBe(false);
  });

  it("writes perch and peek offsets to the owned scene-position channels", () => {
    const { camera, pins, scene } = createFixture();
    pins.setPerchTarget({ edgeLocalYpx: 10 });
    for (let i = 0; i < 20; i += 1) pins.step(camera);
    expect(pins.isConverging()).toBe(false);
    expect(scene.position.y).toBeGreaterThan(0);

    pins.setPerchTarget(null);
    pins.setPeekTarget({ targetXpx: 90 });
    for (let i = 0; i < 20; i += 1) pins.step(camera);
    expect(pins.isConverging()).toBe(false);
    expect(scene.position.x).toBeGreaterThan(0);
    expect(scene.position.z).toBeCloseTo(0);
  });

  it("no-ops without an adopted VRM, hips bone, or active pin", () => {
    const { camera, log, mountHeight, mountWidth, pins, scene } = createFixture();
    expect(() => pins.step(camera)).not.toThrow();
    expect(scene.position.toArray()).toEqual([0, 0, 0]);
    expect(mountWidth).not.toHaveBeenCalled();
    expect(mountHeight).not.toHaveBeenCalled();

    pins.onVrmDisposed();
    pins.setPerchTarget({ edgeLocalYpx: 10 });
    expect(() => pins.step(camera)).not.toThrow();

    pins.onVrmLoaded({ scene: new THREE.Object3D() } as unknown as VRM);
    expect(() => pins.step(camera)).not.toThrow();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("keeps distinct error names for the two step paths", () => {
    const { camera, hips, log, pins } = createFixture();
    vi.spyOn(hips, "getWorldPosition").mockImplementation(() => {
      throw new Error("read failed");
    });

    pins.setPerchTarget({ edgeLocalYpx: 10 });
    pins.step(camera);
    expect(log.error).toHaveBeenCalledWith("step_perch", { error: "Error: read failed" });

    pins.setPerchTarget(null);
    log.error.mockClear();
    pins.setPeekTarget({ targetXpx: 90 });
    pins.step(camera);
    expect(log.error).toHaveBeenCalledWith("step_peek", { error: "Error: read failed" });
  });
});

describe("createPinController — lifecycle", () => {
  it("replaces the cached hips bone on load", () => {
    const { pins } = createFixture();
    const replacement = new THREE.Object3D();
    const nextVrm = {
      scene: new THREE.Object3D(),
      humanoid: { getNormalizedBoneNode: () => replacement },
    } as unknown as VRM;

    pins.onVrmLoaded(nextVrm);

    expect(pins.hipsBone()).toBe(replacement);
  });

  it("preserves the perch target but clears offsets, peek state, and cached refs on dispose", () => {
    const { camera, pins, scene } = createFixture();
    pins.setPerchTarget({ edgeLocalYpx: 10 });
    pins.step(camera);
    scene.position.x = 3;
    scene.position.z = 4;
    const pinnedY = scene.position.y;

    pins.onVrmDisposed();

    expect(pins.isPerched()).toBe(true);
    expect(pins.isConverging()).toBe(false);
    expect(pins.hipsBone()).toBeNull();
    expect(scene.position.toArray()).toEqual([0, pinnedY, 0]);

    const nextHips = new THREE.Object3D();
    const nextScene = new THREE.Object3D();
    nextScene.add(nextHips);
    const nextVrm = {
      scene: nextScene,
      humanoid: { getNormalizedBoneNode: () => nextHips },
    } as unknown as VRM;
    pins.onVrmLoaded(nextVrm);
    nextScene.updateWorldMatrix(true, true);
    pins.step(camera);
    expect(nextScene.position.y).toBeCloseTo(pinnedY);

    pins.setPerchTarget(null);
    pins.setPeekTarget({ targetXpx: 90 });
    pins.step(camera);
    const peekFirstX = nextScene.position.x;
    expect(pins.isPeeking()).toBe(true);
    expect(pins.isConverging()).toBe(true);

    pins.onVrmDisposed();

    expect(pins.isPeeking()).toBe(false);
    expect(pins.isConverging()).toBe(false);
    expect(nextScene.position.x).toBe(0);
    expect(nextScene.position.z).toBe(0);

    const finalHips = new THREE.Object3D();
    const finalScene = new THREE.Object3D();
    finalScene.add(finalHips);
    pins.onVrmLoaded({
      scene: finalScene,
      humanoid: { getNormalizedBoneNode: () => finalHips },
    } as unknown as VRM);
    finalScene.updateWorldMatrix(true, true);
    pins.setPeekTarget({ targetXpx: 90 });
    pins.step(camera);
    expect(finalScene.position.x).toBeCloseTo(peekFirstX);
  });
});
