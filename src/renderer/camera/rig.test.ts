/**
 * rig.test.ts
 *
 * Pins the renderer's camera rig — fit-to-bounds framing, wheel zoom, the
 * eased orbit polar, and the travel view window — against the pure helpers
 * it delegates to (computeCameraFit, orbitPosition, clampPolar). Node env,
 * no DOM/WebGL (same pattern as screen-probes.test.ts).
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  CAMERA_AZIMUTH_DEFAULT,
  CAMERA_POLAR_DEFAULT,
  clampPolar,
  computeCameraFit,
  orbitPosition,
} from "../geometry/camera-fit";
import { type CameraRig, createCameraRig } from "./rig";

const W = 800;
const H = 600;
const DEG = Math.PI / 180;

/** Humanoid-sized stand-in: (−0.3, 0, −0.2)–(0.3, 1.6, 0.2). */
const BOX = new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.2), new THREE.Vector3(0.3, 1.6, 0.2));
const FRAMING = { fov: 30, margin: 0.1 };

/** Polar (from +Y) of the camera position on its orbit sphere around `target`. */
function polarOf(camera: THREE.PerspectiveCamera, target: THREE.Vector3): number {
  return Math.acos((camera.position.y - target.y) / camera.position.distanceTo(target));
}

function makeFixture() {
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  // Mutable locals the rig reads through the deps — each case sets what it needs.
  let box: THREE.Box3 | undefined = BOX;
  let perched = false;
  const rig = createCameraRig({
    camera,
    framing: FRAMING,
    getModelBox: () => box,
    isPerched: () => perched,
  });
  return {
    camera,
    rig,
    setBox: (next: THREE.Box3 | undefined): void => {
      box = next;
    },
    setPerched: (next: boolean): void => {
      perched = next;
    },
  };
}

/** The fit() expectation for the fixture box at the camera's current aspect (zoom still 1). */
function expectedFit(camera: THREE.PerspectiveCamera, fov = FRAMING.fov) {
  const fit = computeCameraFit(BOX, {
    fov,
    aspect: camera.aspect,
    margin: FRAMING.margin,
  });
  if (!fit) throw new Error("fixture box must fit");
  return fit;
}

function expectPosition(camera: THREE.PerspectiveCamera, want: THREE.Vector3): void {
  expect(camera.position.x).toBeCloseTo(want.x);
  expect(camera.position.y).toBeCloseTo(want.y);
  expect(camera.position.z).toBeCloseTo(want.z);
}

function stepUntilSettled(rig: CameraRig): void {
  for (let i = 0; i < 100 && rig.isConverging(); i++) rig.step();
}

describe("createCameraRig", () => {
  it("fit frames the box", () => {
    const { camera, rig, setBox } = makeFixture();
    const fit = expectedFit(camera);

    rig.fit();
    expect(camera.fov).toBe(FRAMING.fov);
    expectPosition(
      camera,
      orbitPosition(fit.target, fit.distance, {
        azimuth: CAMERA_AZIMUTH_DEFAULT,
        polar: CAMERA_POLAR_DEFAULT,
      }),
    );

    // No model box → no-op.
    camera.position.set(9, 9, 9);
    setBox(undefined);
    rig.fit();
    expect(camera.position.equals(new THREE.Vector3(9, 9, 9))).toBe(true);

    // No framing → no-op too.
    const bareCamera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
    bareCamera.position.set(3, 4, 5);
    const bare = createCameraRig({
      camera: bareCamera,
      framing: null,
      getModelBox: () => BOX,
      isPerched: () => false,
    });
    bare.fit();
    expect(bareCamera.position.equals(new THREE.Vector3(3, 4, 5))).toBe(true);
  });

  it("setOrbit eases the polar", () => {
    const { camera, rig } = makeFixture();
    rig.fit();
    const { target, distance } = expectedFit(camera);

    rig.setOrbit({ azimuth: 0.5, polar: Math.PI / 3 });
    expect(rig.isConverging()).toBe(true);
    // Azimuth applies at once; the polar is still the pre-ease default.
    expectPosition(
      camera,
      orbitPosition(target, distance, { azimuth: 0.5, polar: CAMERA_POLAR_DEFAULT }),
    );
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.dot(target.clone().sub(camera.position).normalize())).toBeCloseTo(1, 6);

    // One step lands strictly between the old and the new polar.
    rig.step();
    const mid = polarOf(camera, target);
    expect(mid).toBeGreaterThan(Math.PI / 3);
    expect(mid).toBeLessThan(CAMERA_POLAR_DEFAULT);

    // Stepping to settle lands exactly on the requested polar.
    stepUntilSettled(rig);
    expect(rig.isConverging()).toBe(false);
    expectPosition(camera, orbitPosition(target, distance, { azimuth: 0.5, polar: Math.PI / 3 }));
    expect(polarOf(camera, target)).toBeCloseTo(Math.PI / 3, 9);
  });

  it("setZoom scales the distance", () => {
    const { camera, rig } = makeFixture();
    rig.fit();
    const { target, distance } = expectedFit(camera);

    const at1 = camera.position.distanceTo(target);
    expect(at1).toBeCloseTo(distance / 1);
    rig.setZoom(1.5);
    const at15 = camera.position.distanceTo(target);
    expect(at15).toBeCloseTo(distance / 1.5);
    rig.setZoom(2);
    const at2 = camera.position.distanceTo(target);
    expect(at2).toBeCloseTo(distance / 2);
    expect(at2).toBeLessThan(at15);
    expect(at15).toBeLessThan(at1);
  });

  it("framing and view window", () => {
    const { camera, rig } = makeFixture();

    // setFraming re-fits immediately — no extra fit() call.
    rig.setFraming({ fov: 20, margin: 0.1 });
    expect(camera.fov).toBe(20);
    const fit20 = expectedFit(camera, 20);
    expectPosition(
      camera,
      orbitPosition(fit20.target, fit20.distance, {
        azimuth: CAMERA_AZIMUTH_DEFAULT,
        polar: CAMERA_POLAR_DEFAULT,
      }),
    );
    const ref = new THREE.PerspectiveCamera(20, W / H, 0.1, 100);
    expect(Array.from(camera.projectionMatrix.elements)).toEqual(
      Array.from(ref.projectionMatrix.elements),
    );

    // Travel view window: narrow window ⇒ width-bound fit at the window's aspect.
    rig.setViewWindow({ x: 10, y: 20, width: 100, height: 400 });
    rig.resize(800, 600);
    const narrow = computeCameraFit(BOX, { fov: 20, aspect: 100 / 400, margin: FRAMING.margin });
    if (!narrow) throw new Error("fixture box must fit");
    expect(narrow.distance).not.toBeCloseTo(fit20.distance); // guard: the window really is width-bound
    expect(camera.position.distanceTo(fit20.target)).toBeCloseTo(narrow.distance);
    expect(camera.aspect).toBeCloseTo(100 / 400);
    expect(camera.view?.enabled).toBe(true);
    expect(camera.view?.offsetX).toBe(-10);
    expect(camera.view?.offsetY).toBe(-20);
    expect(camera.view?.width).toBe(800);
    expect(camera.view?.height).toBe(600);

    // Clearing the window restores the full canvas.
    rig.setViewWindow(null);
    rig.resize(800, 600);
    expect(camera.aspect).toBeCloseTo(800 / 600);
    expect(camera.view === null || !camera.view.enabled).toBe(true);
    expect(camera.position.distanceTo(fit20.target)).toBeCloseTo(fit20.distance);
  });

  it("perch clamp", () => {
    const { camera, rig, setPerched } = makeFixture();
    rig.fit();
    const { target } = expectedFit(camera);

    rig.setOrbit({ azimuth: 0, polar: 10 * DEG });
    stepUntilSettled(rig);
    expect(rig.isConverging()).toBe(false);

    setPerched(true);
    rig.startEase();
    expect(rig.isConverging()).toBe(true);
    stepUntilSettled(rig);
    expect(rig.isConverging()).toBe(false);
    expect(polarOf(camera, target)).toBeCloseTo(clampPolar(10 * DEG, true));
  });

  it("non-finite input is ignored", () => {
    const { camera, rig } = makeFixture();
    rig.fit();
    const { target, distance } = expectedFit(camera);

    // NaN zoom is a no-op.
    const framed = camera.position.clone();
    rig.setZoom(Number.NaN);
    expect(camera.position.equals(framed)).toBe(true);

    // NaN azimuth keeps the current azimuth but still starts the polar ease.
    rig.setOrbit({ azimuth: Number.NaN, polar: Math.PI / 3 });
    expect(rig.isConverging()).toBe(true);
    stepUntilSettled(rig);
    expect(rig.isConverging()).toBe(false);
    expectPosition(
      camera,
      orbitPosition(target, distance, {
        azimuth: CAMERA_AZIMUTH_DEFAULT,
        polar: Math.PI / 3,
      }),
    );

    // All-NaN orbit is a full no-op — not even the ease starts.
    const settled = camera.position.clone();
    rig.setOrbit({ azimuth: Number.NaN, polar: Number.NaN });
    expect(rig.isConverging()).toBe(false);
    expect(camera.position.equals(settled)).toBe(true);
  });
});
