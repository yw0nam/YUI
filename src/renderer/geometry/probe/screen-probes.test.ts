/**
 * screen-probes.test.ts
 *
 * Pins the renderer's read-only screen probes (feet anchor, width, pixels per
 * metre, hand anchors, tap points, perch seat) against a bare camera and a fake
 * humanoid, comparing against the pure helpers they delegate to. Node env, no
 * DOM/WebGL (same pattern as perch-geometry.test.ts).
 */

import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  characterScreenHeight,
  projectToScreen,
  seatAnchorWorld,
  worldYPerPixel,
} from "./perch-geometry";
import { projectBoxWidthPx, projectFeetAnchor } from "./project-anchor";
import { createScreenProbes } from "./screen-probes";

const W = 400;
const H = 600;

/** Camera at (0, 1, 5) looking at (0, 1, 0) — the model stands 5 units in front. */
function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 1, 5);
  camera.lookAt(0, 1, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/**
 * Bare camera + fake humanoid fixtures. The bones are world-space Object3D
 * nodes exposed through a fake VRM humanoid; the body is a mesh spanning the
 * character box (−0.3, 0, −0.2)–(0.3, 1.6, 0.2) so Box3.setFromObject(scene)
 * is non-empty (bare Object3Ds contribute nothing to a box).
 */
function makeFixture() {
  const camera = makeCamera();
  const scene = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.4));
  body.position.y = 0.8; // rest the box on the ground: y ∈ [0, 1.6]
  scene.add(body);
  const bones = new Map<string, THREE.Object3D>();
  const bone = (name: string, x: number, y: number, z: number): THREE.Object3D => {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(x, y, z);
    scene.add(node);
    bones.set(name, node);
    return node;
  };
  const head = bone("head", 0, 1.5, 0);
  const hips = bone("hips", 0, 0.9, 0);
  bone("upperChest", 0, 1.2, 0);
  bone("chest", 0, 1.1, 0);
  bone("leftHand", -0.4, 0.9, 0);
  const rightHand = bone("rightHand", 0.4, 0.9, 0);
  scene.updateWorldMatrix(true, true);

  const vrm = {
    scene,
    humanoid: { getNormalizedBoneNode: (name: string) => bones.get(name) ?? null },
  } as unknown as VRM;
  const modelBox = new THREE.Box3().setFromObject(scene);

  // Mutable locals the probes read through the deps — each case sets its own.
  let currentVrm: VRM | undefined = vrm;
  let box: THREE.Box3 | undefined = modelBox;
  const make = (overrides?: { hipsBone?: () => THREE.Object3D | null; seatDrop?: number }) =>
    createScreenProbes({
      camera,
      getVrm: () => currentVrm,
      getModelBox: () => box,
      mountWidth: () => W,
      mountHeight: () => H,
      hipsBone: () => hips,
      seatDrop: 0.1,
      ...overrides,
    });
  return {
    camera,
    modelBox,
    hips,
    head,
    rightHand,
    make,
    hideVrm: (): void => {
      currentVrm = undefined;
    },
    hideBox: (): void => {
      box = undefined;
    },
    /** Move the posed model without touching the box captured at load time. */
    moveBody: (dy: number): void => {
      body.position.y += dy;
      scene.updateWorldMatrix(true, true);
    },
    removeBone: (name: string): void => {
      bones.delete(name);
    },
  };
}

describe("createScreenProbes", () => {
  it("returns null from every probe with no VRM and no model box", () => {
    const { make, hideVrm, hideBox } = makeFixture();
    hideVrm();
    hideBox();
    const probes = make();
    expect(probes.getCharacterAnchor()).toBeNull();
    expect(probes.getCharacterWidthPx()).toBeNull();
    expect(probes.getPerchProbe()).toBeNull();
    expect(probes.getTapPoints()).toBeNull();
    expect(probes.getHandAnchors()).toBeNull();
    expect(probes.getPxPerMetre()).toBeNull();
  });

  it("projects the feet anchor and width the same way the pure helpers do", () => {
    const { camera, modelBox, make, hideVrm } = makeFixture();
    hideVrm();
    const probes = make();
    expect(probes.getCharacterAnchor()).toEqual(projectFeetAnchor(modelBox, camera, W, H));
    expect(probes.getCharacterWidthPx()).toBeCloseTo(projectBoxWidthPx(modelBox, camera, W)!);
  });

  it("reports a finite positive pixels-per-metre that grows as the model comes closer", () => {
    const { camera, modelBox, make } = makeFixture();
    const probes = make();
    const far = probes.getPxPerMetre();
    expect(far).not.toBeNull();
    expect(Number.isFinite(far!)).toBe(true);
    // A positive, growing value survives any constant rescale; pin the scale itself.
    const { min, max } = modelBox;
    const feet = new THREE.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
    const depth = feet.sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3()));
    expect(far!).toBeCloseTo(1 / worldYPerPixel(camera, depth, H)!, 9);
    modelBox.translate(new THREE.Vector3(0, 0, 1)); // 1 unit toward the camera at z=5.
    const near = probes.getPxPerMetre();
    expect(near).not.toBeNull();
    expect(Number.isFinite(near!)).toBe(true);
    expect(near!).toBeGreaterThan(far!);
  });

  it("returns hand anchors only when both hand bones exist", () => {
    const { make, removeBone, rightHand } = makeFixture();
    const hands = make().getHandAnchors();
    expect(hands).not.toBeNull();
    expect(hands!.left.x).toBeLessThan(hands!.right.x);
    removeBone(rightHand.name);
    expect(make().getHandAnchors()).toBeNull();

    const noLeft = makeFixture();
    noLeft.removeBone("leftHand");
    expect(noLeft.make().getHandAnchors()).toBeNull();
  });

  it("returns tap points with the projected character height", () => {
    const { camera, modelBox, head, make } = makeFixture();
    const taps = make().getTapPoints();
    expect(taps).not.toBeNull();
    expect(taps!.head).not.toBeNull();
    expect(taps!.chest).not.toBeNull();
    expect(taps!.hips).not.toBeNull();
    expect(taps!.head!.y).toBeLessThan(taps!.hips!.y); // screen y grows downward
    const { min, max } = modelBox;
    const feet = new THREE.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
    const headWorld = head.getWorldPosition(new THREE.Vector3());
    expect(taps!.charHpx).toBeCloseTo(characterScreenHeight(headWorld, feet, camera, W, H)!, 9);

    // The chest point prefers `upperChest`, falling back to the lower `chest` bone.
    const noUpperChest = makeFixture();
    noUpperChest.removeBone("upperChest");
    const fallback = noUpperChest.make().getTapPoints()!.chest;
    expect(fallback).not.toBeNull();
    expect(fallback!.y).toBeGreaterThan(taps!.chest!.y); // chest sits below upperChest
  });

  it("seats the perch probe at the hips dropped by seatDrop", () => {
    const { camera, hips, head, modelBox, make } = makeFixture();
    const probe = make().getPerchProbe();
    expect(probe).not.toBeNull();
    const headWorld = head.getWorldPosition(new THREE.Vector3());
    const { min, max } = modelBox;
    const feet = new THREE.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
    expect(probe!.charHpx).toBeCloseTo(characterScreenHeight(headWorld, feet, camera, W, H)!, 9);
    const hipsWorld = hips.getWorldPosition(new THREE.Vector3());
    const expected = projectToScreen(seatAnchorWorld(hipsWorld, 0.1), camera, W, H)!;
    expect(probe!.seatPx.x).toBeCloseTo(expected.x, 9);
    expect(probe!.seatPx.y).toBeCloseTo(expected.y, 9);
    const deeper = make({ seatDrop: 0.5 }).getPerchProbe()!;
    expect(deeper.seatPx.y).toBeGreaterThan(probe!.seatPx.y); // a larger drop seats lower
  });

  it("projects against the camera's current transform without the caller refreshing it", () => {
    const { camera, modelBox, make } = makeFixture();
    const probes = make();
    camera.position.set(0, 1, 3); // move in, and deliberately leave the matrices stale
    const got = probes.getCharacterAnchor();
    camera.updateMatrixWorld(); // only now refresh, to build the expectation
    expect(got).toEqual(projectFeetAnchor(modelBox, camera, W, H));
  });

  it("measures the height from the live scene bounds, not the box captured at load", () => {
    const { camera, modelBox, head, make, moveBody } = makeFixture();
    const probes = make();
    moveBody(0.5); // the posed model rises; the cached box stays where it was
    const headWorld = head.getWorldPosition(new THREE.Vector3());
    const live = new THREE.Vector3(
      (modelBox.min.x + modelBox.max.x) / 2,
      modelBox.min.y + 0.5,
      (modelBox.min.z + modelBox.max.z) / 2,
    );
    const cached = new THREE.Vector3(
      (modelBox.min.x + modelBox.max.x) / 2,
      modelBox.min.y,
      (modelBox.min.z + modelBox.max.z) / 2,
    );
    const fromLive = characterScreenHeight(headWorld, live, camera, W, H)!;
    const fromCached = characterScreenHeight(headWorld, cached, camera, W, H)!;
    expect(fromLive).not.toBeCloseTo(fromCached, 3); // the two arms must be distinguishable
    expect(probes.getTapPoints()!.charHpx).toBeCloseTo(fromLive, 9);
  });

  it("returns null from the perch probe with no hips bone", () => {
    const { make } = makeFixture();
    const probes = make({ hipsBone: () => null });
    expect(probes.getPerchProbe()).toBeNull();
    expect(probes.getCharacterAnchor()).not.toBeNull();
  });
});
