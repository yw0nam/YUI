/**
 * alpha-hit-test.test.ts — stateful alpha silhouette wrapper.
 *
 * Pins the frame gate, the single-in-flight async readback, publish-on-resolve,
 * the staleness guards, threshold updates, and lifecycle with a renderer fake
 * whose async reads resolve only when the test says so.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { type AlphaHitTestDeps, createAlphaHitTest } from "./alpha-hit-test";

/** Let the readback promise chain run to completion. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

interface PendingRead {
  width: number;
  height: number;
  settle(): void;
  fail(error: unknown): void;
}

function createFixture(options: { loaded?: boolean; alpha?: number } = {}) {
  let loaded = options.loaded ?? true;
  const alpha = options.alpha ?? 255;
  let bufferW = 800;
  let bufferH = 600;
  const pending: PendingRead[] = [];

  const readRenderTargetPixelsAsync = vi.fn(
    (
      target: THREE.WebGLRenderTarget,
      _x: number,
      _y: number,
      width: number,
      height: number,
      buffer: Uint8Array,
    ) => {
      expect(target).toBeInstanceOf(THREE.WebGLRenderTarget);
      return new Promise<Uint8Array>((resolve, reject) => {
        pending.push({
          width,
          height,
          settle() {
            const col = Math.floor(width / 2);
            const row = Math.floor(height / 2);
            buffer[(row * width + col) * 4 + 3] = alpha;
            resolve(buffer);
          },
          fail: reject,
        });
      });
    },
  );
  const setRenderTarget = vi.fn();
  const render = vi.fn();
  const renderer = {
    getContext: () => ({ drawingBufferWidth: bufferW, drawingBufferHeight: bufferH }),
    getRenderTarget: () => null,
    setRenderTarget,
    render,
    readRenderTargetPixelsAsync,
  };
  const log = { error: vi.fn() };
  const hitTest = createAlphaHitTest({
    renderer: renderer as unknown as THREE.WebGLRenderer,
    scene: {} as THREE.Scene,
    camera: {} as THREE.Camera,
    isVrmLoaded: () => loaded,
    mountWidth: () => 100,
    mountHeight: () => 100,
    log,
  } satisfies AlphaHitTestDeps);

  function takePending(): PendingRead {
    const next = pending.shift();
    if (!next) throw new Error("no async read in flight");
    return next;
  }

  return {
    hitTest,
    readRenderTargetPixelsAsync,
    setRenderTarget,
    render,
    log,
    pending,
    /** Advance to the next grab frame (the gate lets every 3rd refresh through). */
    refreshToNextGrab() {
      hitTest.refresh();
      hitTest.refresh();
      hitTest.refresh();
    },
    async settleRead(): Promise<void> {
      takePending().settle();
      await flush();
    },
    async failRead(error: unknown): Promise<void> {
      takePending().fail(error);
      await flush();
    },
    setLoaded(value: boolean) {
      loaded = value;
    },
    setDrawingBuffer(width: number, height: number) {
      bufferW = width;
      bufferH = height;
    },
  };
}

describe("createAlphaHitTest — refresh", () => {
  it("does not grab or hit while no VRM is loaded", () => {
    const { hitTest, readRenderTargetPixelsAsync } = createFixture({ loaded: false });

    hitTest.refresh();

    expect(readRenderTargetPixelsAsync).not.toHaveBeenCalled();
    expect(hitTest.hitTest(50, 50)).toBe(false);
    hitTest.dispose();
  });

  it("issues a read only on frames 0, 3, and 6", async () => {
    const fixture = createFixture();
    const { hitTest, readRenderTargetPixelsAsync } = fixture;
    const expectedCalls = [1, 1, 1, 2, 2, 2, 3];

    for (const expected of expectedCalls) {
      hitTest.refresh();
      expect(readRenderTargetPixelsAsync).toHaveBeenCalledTimes(expected);
      if (fixture.pending.length > 0) await fixture.settleRead();
    }
    hitTest.dispose();
  });

  it("renders into the target before issuing the read for it at the current dims", () => {
    const { hitTest, readRenderTargetPixelsAsync, setRenderTarget, render } = createFixture();

    hitTest.refresh();

    const target = setRenderTarget.mock.calls[0]?.[0] as THREE.WebGLRenderTarget;
    expect(target).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(render.mock.invocationCallOrder[0]).toBeLessThan(
      readRenderTargetPixelsAsync.mock.invocationCallOrder[0],
    );
    expect(readRenderTargetPixelsAsync).toHaveBeenCalledWith(
      target,
      0,
      0,
      100,
      75,
      expect.any(Uint8Array),
    );
    hitTest.dispose();
  });

  it("keeps at most one read in flight and issues again after it resolves", async () => {
    const fixture = createFixture();
    const { hitTest, readRenderTargetPixelsAsync, render } = fixture;

    hitTest.refresh();
    fixture.refreshToNextGrab();

    expect(render).toHaveBeenCalledTimes(2);
    expect(readRenderTargetPixelsAsync).toHaveBeenCalledTimes(1);

    await fixture.settleRead();
    fixture.refreshToNextGrab();

    expect(readRenderTargetPixelsAsync).toHaveBeenCalledTimes(2);
    hitTest.dispose();
  });
});

describe("createAlphaHitTest — publish on resolve", () => {
  it("publishes the silhouette only once the read resolves", async () => {
    const fixture = createFixture();
    const { hitTest } = fixture;

    hitTest.refresh();
    expect(hitTest.hitTest(50, 50)).toBe(false);

    await fixture.settleRead();

    expect(hitTest.hitTest(50, 50)).toBe(true);
    hitTest.dispose();
  });

  it("publishes with the dims recorded at issue time", async () => {
    const fixture = createFixture();
    const { hitTest } = fixture;

    hitTest.refresh();
    fixture.setDrawingBuffer(400, 300);
    await fixture.settleRead();

    expect(hitTest.hitTest(50, 50)).toBe(true);
    hitTest.dispose();
  });

  it("distinguishes an opaque cell from a transparent cell", async () => {
    const fixture = createFixture();
    const { hitTest } = fixture;

    hitTest.refresh();
    await fixture.settleRead();

    expect(hitTest.hitTest(50, 50)).toBe(true);
    expect(hitTest.hitTest(0, 0)).toBe(false);
    hitTest.dispose();
  });
});

describe("createAlphaHitTest — staleness guards", () => {
  it("publishes nothing from a read issued before clearGrab", async () => {
    const fixture = createFixture();
    const { hitTest } = fixture;

    hitTest.refresh();
    hitTest.clearGrab();
    await fixture.settleRead();

    expect(hitTest.hitTest(50, 50)).toBe(false);

    fixture.refreshToNextGrab();
    await fixture.settleRead();

    expect(hitTest.hitTest(50, 50)).toBe(true);
    hitTest.dispose();
  });

  it("publishes nothing from a read issued before a resize", async () => {
    const fixture = createFixture();
    const { hitTest } = fixture;

    hitTest.refresh();
    fixture.setDrawingBuffer(400, 300);
    fixture.refreshToNextGrab();
    await fixture.settleRead();

    expect(hitTest.hitTest(50, 50)).toBe(false);

    fixture.refreshToNextGrab();
    await fixture.settleRead();

    expect(hitTest.hitTest(50, 50)).toBe(true);
    hitTest.dispose();
  });

  it("touches nothing when a read resolves after dispose", async () => {
    const fixture = createFixture();
    const { hitTest } = fixture;

    hitTest.refresh();
    hitTest.dispose();

    await expect(fixture.settleRead()).resolves.toBeUndefined();
    expect(hitTest.hitTest(50, 50)).toBe(false);
    expect(() => hitTest.dispose()).not.toThrow();
  });

  it("clearGrab drops the published silhouette", async () => {
    const fixture = createFixture();
    const { hitTest } = fixture;

    hitTest.refresh();
    await fixture.settleRead();
    expect(hitTest.hitTest(50, 50)).toBe(true);

    hitTest.clearGrab();

    expect(hitTest.hitTest(50, 50)).toBe(false);
    hitTest.dispose();
  });
});

describe("createAlphaHitTest — rejected read", () => {
  it("logs the error, keeps the published grab, and can issue again", async () => {
    const fixture = createFixture();
    const { hitTest, log, readRenderTargetPixelsAsync } = fixture;

    hitTest.refresh();
    await fixture.settleRead();
    expect(hitTest.hitTest(50, 50)).toBe(true);

    fixture.refreshToNextGrab();
    await fixture.failRead(new Error("context lost"));

    expect(log.error).toHaveBeenCalledWith("alpha_grab_error", {
      error: "Error: context lost",
    });
    expect(hitTest.hitTest(50, 50)).toBe(true);

    fixture.refreshToNextGrab();

    expect(readRenderTargetPixelsAsync).toHaveBeenCalledTimes(3);
    hitTest.dispose();
  });
});

describe("createAlphaHitTest — threshold", () => {
  it("ignores invalid thresholds and applies a valid threshold", async () => {
    const fixture = createFixture({ alpha: 100 });
    const { hitTest } = fixture;

    hitTest.refresh();
    await fixture.settleRead();
    expect(hitTest.hitTest(50, 50)).toBe(true);

    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0, -0.1, 1.1]) {
      hitTest.setThreshold(invalid);
      expect(hitTest.hitTest(50, 50)).toBe(true);
    }

    hitTest.setThreshold(0.5);
    expect(hitTest.hitTest(50, 50)).toBe(false);
    hitTest.dispose();
  });
});
