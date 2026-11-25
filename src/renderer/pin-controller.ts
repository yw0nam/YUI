/**
 * Perch/peek pins — the stateful three.js apply layer over the pure
 * ./perch-geometry math.
 *
 * Owns both pin targets, accumulated offsets, the cached VRM/hips bone, and the
 * per-frame scratch vectors. step() applies the perch pin before the peek pin;
 * nothing else reads pin state except through this controller.
 */

import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { Logger } from "../logger";
import type { ViewWindow } from "./camera/view-window";
import {
  peekOffsetIncrement,
  projectToScreen,
  SEAT_DROP_DEFAULT,
  seatAnchorWorldInto,
  seatOffsetWorldY,
  worldYPerPixel,
} from "./geometry/probe/perch-geometry";
import { easeInOut } from "./motion/yaw/body-yaw";

/** Per-frame convergence rate for the seat-pin offset (proportional step). */
const PERCH_PIN_RATE = 0.6;

/** A side-peek pin: her hips' x in her window's px, an ease-in time, and whether it holds `peeking`. */
export interface PeekTarget {
  targetXpx: number;
  easeMs?: number;
  /** Defaults to true; a pin that holds no posture lets every motion and idle return play. */
  holdsPosture?: boolean;
}

export interface PinController {
  /** Adopt the VRM: cache it and its hips bone for the per-frame pins. */
  onVrmLoaded(vrm: VRM): void;
  /**
   * Drop the cached VRM/hips refs, clear pin offsets and convergence, clear the
   * peek target, and restore scene x/z while preserving the perch target.
   */
  onVrmDisposed(): void;
  /** Cached hips bone — shared with the probe/tap projections. Null when unloaded. */
  hipsBone(): THREE.Object3D | null;
  /** Set or clear the window-sit vertical pin. Returns whether the perched state changed. */
  setPerchTarget(target: { edgeLocalYpx: number } | null): boolean;
  /**
   * Set or clear the side-peek horizontal pin; a clear with `release` eases the offset back to 0.
   * Returns whether the `peeking` posture changed.
   */
  setPeekTarget(target: PeekTarget | null, release?: { easeMs: number }): boolean;
  isPerched(): boolean;
  /** A peek pin that holds the `peeking` posture is set. */
  isPeeking(): boolean;
  /** True while either pin is still stepping toward its target or easing. */
  isConverging(): boolean;
  /** One frame of both pins (`dt` in seconds) — no-op without an adopted VRM, hips bone, or target. */
  step(camera: THREE.PerspectiveCamera, dt: number): void;
  /** World-Y offset the perch pin wants on vrm.scene; 0 when not perched. */
  perchOffsetY(): number;
}

export function createPinController(deps: {
  log: Logger;
  mountWidth: () => number;
  mountHeight: () => number;
  /** A travel's view window inside the canvas, else null. */
  viewWindow: () => ViewWindow | null;
}): PinController {
  const { log, mountHeight, mountWidth } = deps;

  let currentVrm: VRM | null = null;

  // ── Window-sit perch state ──────────────────────────────────────────────────
  // Active target's top-edge in pet-window-local px (null = not perched).
  let perchTargetYpx: number | null = null;
  // Vertical offset the perch wants on vrm.scene; the grounding writes it into scene.position.y.
  let perchOffsetY = 0;
  // Cached hips bone for the per-frame pin (refreshed on load; no per-frame lookup).
  let perchHipsBone: THREE.Object3D | null = null;
  // True while the seat-pin offset is still stepping toward the target (not settled).
  let perchConverging = false;
  // Scratch vectors reused every frame — no per-frame allocation in the pin path.
  const perchHipsWorld = new THREE.Vector3();
  const perchSeatWorld = new THREE.Vector3();
  const perchCamForward = new THREE.Vector3();
  const perchSeatRel = new THREE.Vector3();

  // ── Side-peek pin state ─────────────────────────────────────────────────────
  let peekTarget: PeekTarget | null = null;
  // The converged offset, and the share of it written to the scene while an ease runs.
  let peekOffset = 0;
  let peekApplied = 0;
  let peekConverging = false;
  // The applied share eases from `from` to `to` over `ms`; null once settled at 1.
  let peekEase: { from: number; to: number; ms: number; elapsedMs: number } | null = null;
  const peekHipsWorld = new THREE.Vector3();
  const peekCamForward = new THREE.Vector3();
  const peekHipsRel = new THREE.Vector3();
  const peekCameraRight = new THREE.Vector3();

  /**
   * One frame of seat-pin alignment — called after mixer.update, before vrm.update.
   * Projects the live hips (+SEAT_DROP) seat to px, measures how far it is from the
   * target edge in world-Y, and steps the perch offset toward it.
   *
   * The seat is read from the scene as last written, so the loop closes through whatever
   * writes scene.position.y. Proportional step (PERCH_PIN_RATE) ⇒ converges in ~1-2 frames
   * and re-pins for free across window_sit variant swaps (each new pose's seat re-aligns).
   * No-op when unset.
   */
  function stepPerch(camera: THREE.PerspectiveCamera): void {
    if (perchTargetYpx === null || !currentVrm || !perchHipsBone) return;
    try {
      const w = mountWidth();
      const h = mountHeight();
      // Live posed hips → seat-contact world point (hips dropped by SEAT_DROP on Y).
      perchHipsBone.getWorldPosition(perchHipsWorld);
      seatAnchorWorldInto(perchSeatWorld, perchHipsWorld, SEAT_DROP_DEFAULT);
      const seatPx = projectToScreen(perchSeatWorld, camera, w, h);
      if (!seatPx) return;
      // View-axis depth: project (seat − eye) onto camera forward. worldYPerPixel's
      // perspective formula expects on-axis depth, not Euclidean distance.
      camera.getWorldDirection(perchCamForward);
      const depth = perchSeatRel.copy(perchSeatWorld).sub(camera.position).dot(perchCamForward);
      const wpp = worldYPerPixel(camera, depth, h);
      const delta = seatOffsetWorldY(seatPx.y, perchTargetYpx, wpp);
      // Sub-pixel residual ⇒ settled; lets the frame gate drop to idle fps once pinned.
      perchConverging = Math.abs(delta) > wpp;
      // Proportional step toward the target offset (converges in a couple frames).
      perchOffsetY += delta * PERCH_PIN_RATE;
    } catch (err) {
      log.error("step_perch", { error: String(err) });
    }
  }

  function resetPeek(): void {
    peekTarget = null;
    peekOffset = 0;
    peekApplied = 0;
    peekConverging = false;
    peekEase = null;
    if (currentVrm) {
      currentVrm.scene.position.x = 0;
      currentVrm.scene.position.z = 0;
    }
  }

  /** The eased share of the converged offset after `dt`; 1 with no ease running. */
  function easeShare(dt: number): number {
    if (!peekEase) return 1;
    peekEase.elapsedMs += dt * 1000;
    const t = Math.min(1, peekEase.elapsedMs / peekEase.ms);
    const share = peekEase.from + (peekEase.to - peekEase.from) * easeInOut(t);
    if (t >= 1) peekEase = null;
    return share;
  }

  function stepPeek(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!currentVrm || !perchHipsBone || (peekTarget === null && !peekEase)) return;
    try {
      if (peekTarget === null) {
        // A release: the frozen offset eases to 0, then the pin clears.
        const share = easeShare(dt);
        if (!peekEase) {
          resetPeek();
          return;
        }
        peekApplied = peekOffset * share;
      } else {
        // A travel draws her window's view at an offset inside a larger canvas.
        const view = deps.viewWindow();
        const h = mountHeight();
        perchHipsBone.getWorldPosition(peekHipsWorld);
        const hipsPx = projectToScreen(peekHipsWorld, camera, mountWidth(), h);
        if (!hipsPx) return;

        camera.getWorldDirection(peekCamForward);
        const depth = peekHipsRel.copy(peekHipsWorld).sub(camera.position).dot(peekCamForward);
        // Perspective world-units-per-pixel is identical on both axes for square pixels.
        const worldPerPixel = worldYPerPixel(camera, depth, view?.height ?? h);
        // Measured against the hips as the full converged offset would place them.
        const pixelDelta =
          peekTarget.targetXpx +
          (view?.x ?? 0) -
          hipsPx.x -
          (peekOffset - peekApplied) / worldPerPixel;
        peekConverging = Math.abs(pixelDelta) > 1;
        peekOffset += peekOffsetIncrement(pixelDelta, worldPerPixel, PERCH_PIN_RATE);
        peekApplied = peekOffset * easeShare(dt);
      }
      peekCameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      currentVrm.scene.position.x = peekCameraRight.x * peekApplied;
      currentVrm.scene.position.z = peekCameraRight.z * peekApplied;
    } catch (err) {
      log.error("step_peek", { error: String(err) });
    }
  }

  const holdsPosture = (): boolean => peekTarget !== null && peekTarget.holdsPosture !== false;

  return {
    onVrmLoaded(vrm) {
      currentVrm = vrm;
      // Cache the hips bone for the per-frame perch pin (avoids per-frame lookups).
      perchHipsBone = vrm.humanoid?.getNormalizedBoneNode("hips") ?? null;
    },
    onVrmDisposed() {
      // Drop the perch bone ref so a stale bone can't be pinned on the next VRM.
      perchHipsBone = null;
      perchOffsetY = 0;
      perchConverging = false;
      resetPeek();
      currentVrm = null;
    },
    hipsBone() {
      return perchHipsBone;
    },
    setPerchTarget(target) {
      const wasPerched = perchTargetYpx !== null;
      if (target === null) {
        perchTargetYpx = null;
        perchOffsetY = 0;
        perchConverging = false;
        return wasPerched;
      }
      if (peekTarget !== null) {
        log.warn("perch_pin_conflict", { active: "peek", requested: "perch" });
        return false;
      }
      perchTargetYpx = target.edgeLocalYpx;
      return !wasPerched;
    },
    setPeekTarget(target, release) {
      const wasPeeking = holdsPosture();
      if (target === null) {
        if (release && peekTarget !== null) {
          peekTarget = null;
          peekOffset = peekApplied;
          peekConverging = false;
          peekEase = { from: 1, to: 0, ms: release.easeMs, elapsedMs: 0 };
        } else {
          resetPeek();
        }
        return wasPeeking;
      }
      if (perchTargetYpx !== null) {
        log.warn("perch_pin_conflict", { active: "perch", requested: "peek" });
        return false;
      }
      if (peekTarget === null) {
        peekEase = target.easeMs ? { from: 0, to: 1, ms: target.easeMs, elapsedMs: 0 } : null;
      }
      peekTarget = target;
      return wasPeeking !== holdsPosture();
    },
    isPerched() {
      return perchTargetYpx !== null;
    },
    isPeeking: holdsPosture,
    isConverging() {
      return perchConverging || peekConverging || peekEase !== null;
    },
    step(camera, dt) {
      stepPerch(camera);
      stepPeek(camera, dt);
    },
    perchOffsetY() {
      return perchOffsetY;
    },
  };
}
