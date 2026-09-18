/** Camera rig: fit-to-bounds framing, wheel zoom, the eased orbit polar, and the travel view window. */
import type * as THREE from "three";
import type { FramingConfig } from "../../config/load";
import {
  CAMERA_AZIMUTH_DEFAULT,
  CAMERA_POLAR_DEFAULT,
  clampPolar,
  computeCameraFit,
  type OrbitAngles,
  orbitPosition,
} from "../geometry/camera-fit";
import { applyViewWindow, type ViewWindow } from "../geometry/view-window";

/**
 * Per-frame ease rate for the effective orbit polar (proportional step). Drag nudges
 * land in ~2 frames (feels direct); the larger jump when the perch clamp tightens the
 * polar into [60°,120°] eases over several frames instead of snapping.
 */
const ORBIT_EASE_RATE = 0.35;
/** Below this |Δpolar| (radians) the orbit ease is settled (≈0.06°). */
const ORBIT_SETTLE_EPS = 1e-3;

export interface CameraRigDeps {
  camera: THREE.PerspectiveCamera;
  framing: FramingConfig | null;
  getModelBox: () => THREE.Box3 | undefined;
  isPerched: () => boolean;
}

export interface CameraRig {
  fit(): void;
  /** Camera half of a canvas resize: aspect (view window or canvas), projection, re-fit, view offset. */
  resize(w: number, h: number): void;
  step(): void;
  isConverging(): boolean;
  /** Mark the polar as easing so the next frame renders uncapped (perch set/cleared). */
  startEase(): void;
  setFraming(next: FramingConfig): void;
  /** Stores the view window; the caller runs its resize to apply it. */
  setViewWindow(next: ViewWindow | null): void;
  setZoom(z: number): void;
  setOrbit(angles: OrbitAngles): void;
}

export function createCameraRig(deps: CameraRigDeps): CameraRig {
  const { camera, getModelBox, isPerched } = deps;

  // Set during a travel: draws the reference-size framing at an offset in the parked
  // canvas instead of filling it. null the rest of the time.
  let view: ViewWindow | null = null;
  // configs/avatar.json framing — null until setFraming delivers it (the renderer is
  // built before the config loads), and nothing is framed before then.
  let framing: FramingConfig | null = deps.framing;
  // Mouse-wheel zoom factor on top of the fit distance: >1 ⇒ closer ⇒ bigger.
  // Bounds/persistence live in src/io + main.ts (setZoom just applies). Default 1 = exact fit.
  let zoom = 1;
  // Orbit viewpoint on the fit sphere. azimuth/polar are the stored *free* angles
  // (clamp/persist in src/io + main.ts). effectivePolar is what the camera uses — it
  // eases toward the free polar, or toward the tightened perched clamp while perched.
  // azimuth applies directly (no clamp, no ease). Default (0, 90°) = head-on.
  let azimuth = CAMERA_AZIMUTH_DEFAULT;
  let polar = CAMERA_POLAR_DEFAULT;
  let effectivePolar = polar;
  // True while effectivePolar is still easing toward its target (keeps frames uncapped).
  let orbitConverging = false;

  /** Reframe the camera to the current model box; no-op when no model is loaded. */
  function fitCamera(): void {
    const modelBox = getModelBox();
    if (!modelBox || !framing) return;
    const fit = computeCameraFit(modelBox, {
      fov: framing.fov,
      aspect: camera.aspect,
      margin: framing.margin,
    });
    if (!fit) return;
    const d = fit.distance / zoom; // zoom>1 ⇒ camera closer ⇒ character bigger.
    camera.fov = framing.fov;
    // Orbit composes with the radius: orbit sets direction, zoom sets the radius d.
    // effectivePolar is the eased polar (free, or perched-clamped).
    const pos = orbitPosition(fit.target, d, { azimuth, polar: effectivePolar });
    camera.position.copy(pos);
    camera.lookAt(fit.target);
    camera.updateProjectionMatrix();
  }

  /** Target polar the camera should settle at: tightened to the perched band while perched. */
  function desiredPolar(): number {
    return clampPolar(polar, isPerched());
  }

  /**
   * Ease effectivePolar one proportional step toward {@link desiredPolar} and re-fit.
   * No-op once settled (sub-epsilon) — keeps idle frames off the re-fit path. Runs each
   * frame from the rAF loop; orbitConverging gates the frame cap while still easing.
   */
  function stepOrbit(): void {
    const target = desiredPolar();
    const diff = target - effectivePolar;
    if (Math.abs(diff) <= ORBIT_SETTLE_EPS) {
      if (effectivePolar !== target) {
        effectivePolar = target;
        fitCamera();
      }
      orbitConverging = false;
      return;
    }
    effectivePolar += diff * ORBIT_EASE_RATE;
    orbitConverging = true;
    fitCamera();
  }

  function resize(w: number, h: number): void {
    camera.aspect = view ? view.width / view.height : w / h;
    camera.updateProjectionMatrix();
    fitCamera(); // re-fit on resize so width-bound framing stays correct.
    applyViewWindow(camera, view, w, h);
  }

  function isConverging(): boolean {
    return orbitConverging;
  }

  function startEase(): void {
    orbitConverging = true;
  }

  function setFraming(next: FramingConfig): void {
    framing = next;
    fitCamera();
  }

  function setViewWindow(next: ViewWindow | null): void {
    view = next;
  }

  /** setZoom implementation — ignore non-finite/identical, otherwise update zoom then refit. */
  function setZoom(z: number): void {
    if (!Number.isFinite(z)) return;
    if (z === zoom) return;
    zoom = z;
    fitCamera();
  }

  /**
   * setOrbit implementation — azimuth applies immediately (refit); polar is saved as free value and
   * orbitConverging is enabled to ease effectivePolar toward desiredPolar (stepOrbit converges each frame). Non-finite ignored.
   */
  function setOrbit(angles: OrbitAngles): void {
    const az = Number.isFinite(angles.azimuth) ? angles.azimuth : azimuth;
    const pol = Number.isFinite(angles.polar) ? angles.polar : polar;
    if (az === azimuth && pol === polar) return;
    azimuth = az;
    polar = pol;
    orbitConverging = true; // ease effectivePolar toward the (possibly perched-clamped) target.
    fitCamera(); // apply the azimuth change immediately.
  }

  return {
    fit: fitCamera,
    resize,
    step: stepOrbit,
    isConverging,
    startEase,
    setFraming,
    setViewWindow,
    setZoom,
    setOrbit,
  };
}
