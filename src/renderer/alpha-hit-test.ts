/**
 * Per-pixel alpha hit-test — CPU-side silhouette grab + sampling.
 *
 * Owns ONLY its own mutable state (the low-res RGBA grab, its dims, the frame
 * counter, the threshold, the offscreen target). Re-rendered into a low-res
 * render target inside the rAF loop and read back asynchronously; sampled by
 * hitTest. Decoupled from perch/gaze/orbit/fit — talks to the scene solely
 * through the injected deps.
 */

import * as THREE from "three";
import { cssToGrabCell, grabDimensions, sampleAlphaHit } from "./hit-test";

// ── Per-pixel alpha hit-test ─────────────────────────────────────────────────
/** Downscale factor (linear) of the drawing buffer for the CPU-side alpha grab. */
const ALPHA_GRAB_SCALE = 1 / 8;
/** Cap on the grab width (px) so large displays stay cheap. */
const ALPHA_GRAB_MAX_W = 128;
/** Refresh the grab every Nth frame (~20-30Hz) to spare the frame budget. */
const ALPHA_GRAB_FRAME_GATE = 3;
/** Fallback alpha threshold (0..1) until config injects one. */
const DEFAULT_ALPHA_THRESHOLD = 0.1;

/** Logger surface the grab path needs (matches the renderer logger). */
interface AlphaLog {
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface AlphaHitTestDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Truthy only while a VRM is loaded — no grab without a model. */
  isVrmLoaded: () => boolean;
  /** Current mount CSS width/height in px (for css→grab-cell mapping). */
  mountWidth: () => number;
  mountHeight: () => number;
  log: AlphaLog;
}

export interface AlphaHitTest {
  /**
   * Refresh the low-res alpha grab via an offscreen render target. MUST run
   * inside the rAF loop. Frame-gated; no grab while no VRM is loaded. The
   * readback is asynchronous — at most one read is in flight, and the frame it
   * captures becomes the published grab a few ms later.
   */
  refresh(): void;
  /**
   * Per-pixel alpha hit test: true when the rendered character pixel under the
   * canvas CSS-px point (x, y) is opaque (alpha ≥ threshold). Samples the last
   * published grab, which trails the current frame by a few ms. False until the
   * first read resolves.
   */
  hitTest(x: number, y: number): boolean;
  /**
   * Set the alpha threshold (0..1) the hit test compares against. Non-finite or
   * out-of-(0,1] values are ignored.
   */
  setThreshold(threshold: number): void;
  /**
   * Drop the current grab and discard the in-flight read (stale silhouette can't
   * outlive its VRM).
   */
  clearGrab(): void;
  /** Release the offscreen render target and discard the in-flight read. */
  dispose(): void;
}

export function createAlphaHitTest(deps: AlphaHitTestDeps): AlphaHitTest {
  const { renderer, scene, camera, isVrmLoaded, mountWidth, mountHeight, log } = deps;

  // ── Per-pixel alpha hit-test state ───────────────────────────────────────────
  // Low-res RGBA grab of the silhouette hitTest samples (reused; no per-frame alloc).
  let alphaGrab: Uint8Array | null = null;
  let alphaGrabW = 0;
  let alphaGrabH = 0;
  let alphaFrame = 0;
  // Buffer the in-flight read fills; ping-ponged with alphaGrab on publish so a
  // half-filled buffer never aliases the published one.
  let alphaStaging: Uint8Array | null = null;
  let readPending = false;
  // Bumped whenever the pending read's result stops being publishable (VRM swap,
  // resize, dispose); a resolve from an older generation publishes nothing.
  let grabGeneration = 0;
  // Threshold in 0..1 (config-injected); compared as 0..255 against the grab.
  let alphaThreshold = DEFAULT_ALPHA_THRESHOLD;
  // Offscreen render target sized to the grab dims — the scene is re-rendered into
  // it at low res so the readback reads only gw×gh px (not the full device buffer).
  // Allocated once, resized only when the grab dims change (no per-frame alloc).
  let alphaTarget: THREE.WebGLRenderTarget | null = null;

  /**
   * Refresh the low-res alpha grab via an offscreen render target. The scene is
   * re-rendered into a gw×gh target (the GPU does the downscale) and only those
   * pixels are read back — far cheaper than reading the full device buffer and
   * box-sampling on the CPU. The read is issued asynchronously (PBO + fence) so
   * the main thread never waits on the GL queue; the freshest rendered frame wins
   * because a new read is issued only once the previous one has resolved. MUST run
   * inside the rAF loop. readPixels' origin is bottom-left, so grab rows stay
   * bottom-up (cssToGrabCell's flip holds). Frame-gated to spare the budget. No
   * grab while no VRM is loaded.
   */
  function refresh(): void {
    if (!isVrmLoaded()) {
      clearGrab();
      return;
    }
    if (alphaFrame++ % ALPHA_GRAB_FRAME_GATE !== 0) return;
    try {
      const gl = renderer.getContext();
      // drawingBufferWidth/Height are device px (post devicePixelRatio).
      const dims = grabDimensions(
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        ALPHA_GRAB_SCALE,
        ALPHA_GRAB_MAX_W,
      );
      if (!dims) return;
      const { gw, gh } = dims;
      if (!alphaTarget) {
        alphaTarget = new THREE.WebGLRenderTarget(gw, gh, {
          depthBuffer: true,
          stencilBuffer: false,
        });
      } else if (alphaTarget.width !== gw || alphaTarget.height !== gh) {
        alphaTarget.setSize(gw, gh);
        grabGeneration++;
      }

      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(alphaTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prevTarget);

      if (readPending) return;
      const need = gw * gh * 4;
      if (!alphaStaging || alphaStaging.length < need) alphaStaging = new Uint8Array(need);
      const buffer = alphaStaging;
      const issuedAt = grabGeneration;
      // Flag only once the issue succeeded — a throwing issue must not wedge the grab.
      const read = renderer.readRenderTargetPixelsAsync(alphaTarget, 0, 0, gw, gh, buffer);
      readPending = true;
      read.then(
        () => {
          readPending = false;
          if (issuedAt !== grabGeneration) return;
          alphaStaging = alphaGrab;
          alphaGrab = buffer;
          alphaGrabW = gw;
          alphaGrabH = gh;
        },
        (err: unknown) => {
          readPending = false;
          // The last published grab stays the best silhouette available.
          log.error("alpha_grab_error", { error: String(err) });
        },
      );
    } catch (err) {
      log.error("alpha_grab_error", { error: String(err) });
      clearGrab();
    }
  }

  function hitTest(x: number, y: number): boolean {
    if (!alphaGrab || alphaGrabW === 0 || alphaGrabH === 0) return false;
    const cell = cssToGrabCell(x, y, mountWidth(), mountHeight(), alphaGrabW, alphaGrabH);
    const threshold255 = Math.round(alphaThreshold * 255);
    return sampleAlphaHit(alphaGrab, alphaGrabW, alphaGrabH, cell.col, cell.row, threshold255);
  }

  function setThreshold(threshold: number): void {
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) return;
    alphaThreshold = threshold;
  }

  function clearGrab(): void {
    alphaGrab = null;
    grabGeneration++;
  }

  function dispose(): void {
    alphaTarget?.dispose();
    alphaTarget = null;
    grabGeneration++;
  }

  return { refresh, hitTest, setThreshold, clearGrab, dispose };
}
