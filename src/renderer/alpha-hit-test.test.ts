/**
 * alpha-hit-test.test.ts — stateful alpha silhouette wrapper.
 *
 * Pins the frame gate, threshold updates, silhouette sampling, and lifecycle
 * behavior with a plain renderer fake.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { type AlphaHitTestDeps, createAlphaHitTest } from "./alpha-hit-test";

function createFixture(options: { loaded?: boolean; alpha?: number } = {}) {
  let loaded = options.loaded ?? true;
  const alpha = options.alpha ?? 255;
  const readRenderTargetPixels = vi.fn(
    (
      target: THREE.WebGLRenderTarget,
      _x: number,
      _y: number,
      width: number,
      height: number,
      buffer: Uint8Array,
    ) => {
      expect(target).toBeInstanceOf(THREE.WebGLRenderTarget);
      const col = Math.floor(width / 2);
      const row = Math.floor(height / 2);
      buffer[(row * width + col) * 4 + 3] = alpha;
    },
  );
  const renderer = {
    getContext: () => ({ drawingBufferWidth: 800, drawingBufferHeight: 600 }),
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixels,
  };
  const hitTest = createAlphaHitTest({
    renderer: renderer as unknown as THREE.WebGLRenderer,
    scene: {} as THREE.Scene,
    camera: {} as THREE.Camera,
    isVrmLoaded: () => loaded,
    mountWidth: () => 100,
    mountHeight: () => 100,
    log: { error: vi.fn() },
  } satisfies AlphaHitTestDeps);

  return {
    hitTest,
    readRenderTargetPixels,
    setLoaded(value: boolean) {
      loaded = value;
    },
  };
}

describe("createAlphaHitTest — refresh", () => {
  it("does not grab or hit while no VRM is loaded", () => {
    const { hitTest, readRenderTargetPixels } = createFixture({ loaded: false });

    hitTest.refresh();

    expect(readRenderTargetPixels).not.toHaveBeenCalled();
    expect(hitTest.hitTest(50, 50)).toBe(false);
    hitTest.dispose();
  });

  it("reads back only on frames 0, 3, and 6", () => {
    const { hitTest, readRenderTargetPixels } = createFixture();
    const expectedCalls = [1, 1, 1, 2, 2, 2, 3];

    for (const expected of expectedCalls) {
      hitTest.refresh();
      expect(readRenderTargetPixels).toHaveBeenCalledTimes(expected);
    }
    hitTest.dispose();
  });
});

describe("createAlphaHitTest — threshold and lifecycle", () => {
  it("ignores invalid thresholds and applies a valid threshold", () => {
    const { hitTest } = createFixture({ alpha: 100 });
    hitTest.refresh();
    expect(hitTest.hitTest(50, 50)).toBe(true);

    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0, -0.1, 1.1]) {
      hitTest.setThreshold(invalid);
      expect(hitTest.hitTest(50, 50)).toBe(true);
    }

    hitTest.setThreshold(0.5);
    expect(hitTest.hitTest(50, 50)).toBe(false);
    hitTest.dispose();
  });

  it("distinguishes an opaque cell from a transparent cell after refresh", () => {
    const { hitTest } = createFixture();
    hitTest.refresh();

    expect(hitTest.hitTest(50, 50)).toBe(true);
    expect(hitTest.hitTest(0, 0)).toBe(false);
    hitTest.dispose();
  });

  it("clearGrab drops the silhouette and dispose is safe", () => {
    const { hitTest } = createFixture();
    hitTest.refresh();
    expect(hitTest.hitTest(50, 50)).toBe(true);

    hitTest.clearGrab();

    expect(hitTest.hitTest(50, 50)).toBe(false);
    expect(() => {
      hitTest.dispose();
      hitTest.dispose();
    }).not.toThrow();
  });
});
