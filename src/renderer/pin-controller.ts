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
import {
  peekOffsetIncrement,
  projectToScreen,
  SEAT_DROP_DEFAULT,
  seatAnchorWorldInto,
  seatOffsetWorldY,
  worldYPerPixel,
} from "./perch-geometry";

/** Per-frame convergence rate for the seat-pin offset (proportional step). */
const PERCH_PIN_RATE = 0.6;

export interface PinController {
  /** Adopt the VRM: cache it and its hips bone for the per-frame pins. */
  onVrmLoaded(vrm: VRM): void;
  /**
   * Drop the cached VRM/hips refs, clear pin offsets and convergence, clear the
   * peek target, and restore scene x/z while preserving the perch target and y.
   */
  onVrmDisposed(): void;
  /** Cached hips bone — shared with the probe/tap projections. Null when unloaded. */
  hipsBone(): THREE.Object3D | null;
  /** Set or clear the window-sit vertical pin. Returns whether the perched state changed. */
  setPerchTarget(target: { edgeLocalYpx: number } | null): boolean;
  /** Set or clear the side-peek horizontal pin. Returns whether the peek state changed. */
  setPeekTarget(target: { targetXpx: number } | null): boolean;
  isPerched(): boolean;
  isPeeking(): boolean;
  /** True while either pin is still stepping toward its target. */
  isConverging(): boolean;
  /** One frame of both pins — no-op without an adopted VRM, hips bone, or target. */
  step(camera: THREE.PerspectiveCamera): void;
}

export function createPinController(deps: {
  log: Logger;
  mountWidth: () => number;
  mountHeight: () => number;
}): PinController {
  const { log, mountHeight, mountWidth } = deps;

  let currentVrm: VRM | null = null;

  // ── Window-sit perch state ──────────────────────────────────────────────────
  // Active target's top-edge in pet-window-local px (null = not perched).
  let perchTargetYpx: number | null = null;
  // Dedicated additive vertical offset we fully own — never clobbers root-motion
  // recentering. Applied onto vrm.scene.position.y after the mixer writes each frame.
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
  let peekTarget: { targetXpx: number } | null = null;
  let peekOffset = 0;
  let peekConverging = false;
  const peekHipsWorld = new THREE.Vector3();
  const peekCamForward = new THREE.Vector3();
  const peekHipsRel = new THREE.Vector3();
  const peekCameraRight = new THREE.Vector3();

  /**
   * One frame of seat-pin alignment — called after mixer.update, before vrm.update.
   * Projects the live hips (+SEAT_DROP) seat to px, measures how far it is from the
   * target edge in world-Y, and steps a dedicated additive vertical offset toward it.
   *
   * The VRMA clip animates the hips *bone*, never vrm.scene.position — so scene.position.y
   * is a channel we fully own (no clobbering root recentering). We set it absolutely from
   * the accumulated offset. Proportional step (PERCH_PIN_RATE) ⇒ converges in ~1-2 frames
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
      currentVrm.scene.position.y = perchOffsetY;
    } catch (err) {
      log.error("step_perch", { error: String(err) });
    }
  }

  function stepPeek(camera: THREE.PerspectiveCamera): void {
    if (peekTarget === null || !currentVrm || !perchHipsBone) return;
    try {
      const w = mountWidth();
      const h = mountHeight();
      perchHipsBone.getWorldPosition(peekHipsWorld);
      const hipsPx = projectToScreen(peekHipsWorld, camera, w, h);
      if (!hipsPx) return;

      camera.getWorldDirection(peekCamForward);
      const depth = peekHipsRel.copy(peekHipsWorld).sub(camera.position).dot(peekCamForward);
      // Perspective world-units-per-pixel is identical on both axes for square pixels.
      const worldPerPixel = worldYPerPixel(camera, depth, h);
      const pixelDelta = peekTarget.targetXpx - hipsPx.x;
      peekConverging = Math.abs(pixelDelta) > 1;
      peekOffset += peekOffsetIncrement(pixelDelta, worldPerPixel, PERCH_PIN_RATE);
      peekCameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      currentVrm.scene.position.x = peekCameraRight.x * peekOffset;
      currentVrm.scene.position.z = peekCameraRight.z * peekOffset;
    } catch (err) {
      log.error("step_peek", { error: String(err) });
    }
  }

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
      peekTarget = null;
      peekOffset = 0;
      peekConverging = false;
      if (currentVrm) {
        currentVrm.scene.position.x = 0;
        currentVrm.scene.position.z = 0;
      }
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
        if (currentVrm) currentVrm.scene.position.y = 0; // restore baseline.
        return wasPerched;
      }
      if (peekTarget !== null) {
        log.warn("perch_pin_conflict", { active: "peek", requested: "perch" });
        return false;
      }
      perchTargetYpx = target.edgeLocalYpx;
      return !wasPerched;
    },
    setPeekTarget(target) {
      const wasPeeking = peekTarget !== null;
      if (target === null) {
        peekTarget = null;
        peekOffset = 0;
        peekConverging = false;
        if (currentVrm) {
          currentVrm.scene.position.x = 0;
          currentVrm.scene.position.z = 0;
        }
        return wasPeeking;
      }
      if (perchTargetYpx !== null) {
        log.warn("perch_pin_conflict", { active: "perch", requested: "peek" });
        return false;
      }
      peekTarget = target;
      return !wasPeeking;
    },
    isPerched() {
      return perchTargetYpx !== null;
    },
    isPeeking() {
      return peekTarget !== null;
    },
    isConverging() {
      return perchConverging || peekConverging;
    },
    step(camera) {
      stepPerch(camera);
      stepPeek(camera);
    },
  };
}
