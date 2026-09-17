import type { VRM } from "@pixiv/three-vrm";
import { describe, expect, it } from "vitest";
import { yawAt } from "../geometry/body-yaw";
import { createRootYaw } from "./root-yaw";

describe("createRootYaw", () => {
  it("writes the base rotation and reports settled when no target is set", () => {
    const elapsedMs = 0;
    const rootYaw = createRootYaw({ getElapsedMs: () => elapsedMs });
    const vrm = { scene: { rotation: { y: Math.PI } } } as unknown as VRM;

    rootYaw.onVrmLoaded(vrm);
    rootYaw.step({ vrm, dt: 0, elapsed: 0 });

    expect(vrm.scene.rotation.y).toBe(Math.PI);
    expect(rootYaw.isConverging()).toBe(false);
  });

  it("eases toward the target and settles at its duration", () => {
    let elapsedMs = 0;
    const rootYaw = createRootYaw({ getElapsedMs: () => elapsedMs });
    const vrm = { scene: { rotation: { y: Math.PI } } } as unknown as VRM;

    rootYaw.onVrmLoaded(vrm);
    rootYaw.setTarget(1, 1000);
    elapsedMs = 250;
    rootYaw.step({ vrm, dt: 0.25, elapsed: 0.25 });
    expect(vrm.scene.rotation.y).toBeCloseTo(Math.PI + yawAt(0, 1, 250, 1000));
    expect(rootYaw.isConverging()).toBe(true);

    elapsedMs = 1000;
    rootYaw.step({ vrm, dt: 0.75, elapsed: 1 });
    expect(vrm.scene.rotation.y).toBe(Math.PI + 1);
    expect(rootYaw.isConverging()).toBe(false);
  });

  it("ignores a non-finite target and treats a non-finite ease as immediate", () => {
    const elapsedMs = 0;
    const rootYaw = createRootYaw({ getElapsedMs: () => elapsedMs });
    const vrm = { scene: { rotation: { y: Math.PI } } } as unknown as VRM;

    rootYaw.onVrmLoaded(vrm);
    rootYaw.setTarget(Number.NaN, 100);
    expect(rootYaw.isConverging()).toBe(false);
    rootYaw.step({ vrm, dt: 0, elapsed: 0 });
    expect(vrm.scene.rotation.y).toBe(Math.PI);

    rootYaw.setTarget(0.5, Number.NaN);
    rootYaw.step({ vrm, dt: 0, elapsed: 0 });
    expect(vrm.scene.rotation.y).toBe(Math.PI + 0.5);
    expect(rootYaw.isConverging()).toBe(false);
  });

  it("a hot swap resets the yaw", () => {
    let elapsedMs = 0;
    const rootYaw = createRootYaw({ getElapsedMs: () => elapsedMs });
    const vrm = { scene: { rotation: { y: Math.PI } } } as unknown as VRM;

    rootYaw.onVrmLoaded(vrm);
    rootYaw.setTarget(1, 1000);
    elapsedMs = 250;
    rootYaw.step({ vrm, dt: 0.25, elapsed: 0.25 });

    const swapped = { scene: { rotation: { y: 0 } } } as unknown as VRM;
    rootYaw.onVrmLoaded(swapped);
    rootYaw.step({ vrm: swapped, dt: 0, elapsed: 0.25 });
    expect(swapped.scene.rotation.y).toBe(0);
    expect(rootYaw.isConverging()).toBe(false);
  });
});
