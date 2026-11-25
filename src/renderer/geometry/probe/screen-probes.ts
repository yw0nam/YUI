/** Read-only screen probes of the loaded model: feet anchor, width, seat and tap points, hand anchors, pixels per metre. */
import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { Renderer } from "../../types";
import {
  characterScreenHeight,
  projectToScreen,
  seatAnchorWorld,
  worldYPerPixel,
} from "./perch-geometry";
import { projectBoxWidthPx, projectFeetAnchor } from "./project-anchor";

export interface ScreenProbeDeps {
  camera: THREE.PerspectiveCamera;
  getVrm: () => VRM | undefined;
  getModelBox: () => THREE.Box3 | undefined;
  mountWidth: () => number;
  mountHeight: () => number;
  hipsBone: () => THREE.Object3D | null;
  seatDrop: number;
  /** The camera fit to a window of `aspect` at a stage framing (default the current), null with nothing to fit. */
  cameraAt: (aspect: number, framing?: number) => THREE.PerspectiveCamera | null;
}

export type ScreenProbes = Pick<
  Renderer,
  | "getCharacterAnchor"
  | "getFrameFit"
  | "getCharacterWidthPx"
  | "getPerchProbe"
  | "getTapPoints"
  | "getHandAnchors"
  | "getPxPerMetre"
>;

export function createScreenProbes(deps: ScreenProbeDeps): ScreenProbes {
  const { camera, getVrm, getModelBox, mountWidth, mountHeight, hipsBone, seatDrop, cameraAt } =
    deps;
  const liveBoxScratch = new THREE.Box3();
  const pxPerMetreScratch = new THREE.Vector3();
  const pxPerMetreForward = new THREE.Vector3();
  const liveFeetScratch = new THREE.Vector3();
  const liveHeadScratch = new THREE.Vector3();

  function liveCharacterHeight(head: THREE.Object3D, w: number, h: number): number | null {
    const currentVrm = getVrm();
    const liveBox = currentVrm ? liveBoxScratch.setFromObject(currentVrm.scene) : null;
    const box = liveBox && !liveBox.isEmpty() ? liveBox : getModelBox();
    if (!box) return null;
    liveFeetScratch.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    return characterScreenHeight(
      head.getWorldPosition(liveHeadScratch),
      liveFeetScratch,
      camera,
      w,
      h,
    );
  }

  /** Pixels per metre at her feet through `cam` on a canvas `canvasH` tall; null when not finite. */
  function pxPerMetre(
    cam: THREE.PerspectiveCamera,
    box: THREE.Box3,
    canvasH: number,
  ): number | null {
    cam.updateMatrixWorld();
    // Measured at the feet — the same point the floor gate and the stroll travel on.
    const { min, max } = box;
    const depth = pxPerMetreScratch
      .set((min.x + max.x) / 2, min.y, (min.z + max.z) / 2)
      .sub(cam.position)
      .dot(cam.getWorldDirection(pxPerMetreForward));
    const perPixel = worldYPerPixel(cam, depth, canvasH);
    return Number.isFinite(perPixel) && perPixel > 0 ? 1 / perPixel : null;
  }

  return {
    getFrameFit(width, height, framing) {
      const modelBox = getModelBox();
      const at = modelBox && cameraAt(width / height, framing);
      if (!modelBox || !at) return null;
      const feet = projectFeetAnchor(modelBox, at, 1, 1);
      const there = pxPerMetre(at, modelBox, height);
      const now = pxPerMetre(camera, modelBox, mountHeight());
      if (!feet || there === null || now === null) return null;
      return { feetShare: feet.y, scale: there / now };
    },
    getCharacterAnchor() {
      const modelBox = getModelBox();
      if (!modelBox) return null;
      camera.updateMatrixWorld();
      return projectFeetAnchor(modelBox, camera, mountWidth(), mountHeight());
    },
    getCharacterWidthPx() {
      const modelBox = getModelBox();
      if (!modelBox) return null;
      camera.updateMatrixWorld();
      return projectBoxWidthPx(modelBox, camera, mountWidth());
    },
    getPerchProbe() {
      const currentVrm = getVrm();
      if (!currentVrm) return null;
      const head = currentVrm.humanoid?.getNormalizedBoneNode("head");
      const hips = hipsBone();
      if (!head || !hips) return null;
      const w = mountWidth();
      const h = mountHeight();
      camera.updateMatrixWorld();

      // Seat: live hips (+seatDrop) → pet-window px (mirrors getCharacterAnchor's project path).
      const hipsWorld = hips.getWorldPosition(new THREE.Vector3());
      const seat = seatAnchorWorld(hipsWorld, seatDrop);
      const seatPx = projectToScreen(seat, camera, w, h);
      if (!seatPx) return null;

      const charHpx = liveCharacterHeight(head, w, h);
      if (charHpx === null) return null;

      return { seatPx: { x: seatPx.x, y: seatPx.y }, charHpx };
    },
    getTapPoints() {
      const currentVrm = getVrm();
      if (!currentVrm) return null;
      const humanoid = currentVrm.humanoid;
      const head = humanoid?.getNormalizedBoneNode("head");
      if (!head) return null;
      const w = mountWidth();
      const h = mountHeight();
      camera.updateMatrixWorld();
      const charHpx = liveCharacterHeight(head, w, h);
      if (charHpx === null || !Number.isFinite(charHpx) || charHpx <= 0) return null;
      const project = (bone: THREE.Object3D | null | undefined) =>
        bone ? projectToScreen(bone.getWorldPosition(new THREE.Vector3()), camera, w, h) : null;
      const chest =
        humanoid?.getNormalizedBoneNode("upperChest") ?? humanoid?.getNormalizedBoneNode("chest");
      return {
        head: project(head),
        chest: project(chest),
        hips: project(hipsBone()),
        charHpx,
      };
    },
    getHandAnchors() {
      const currentVrm = getVrm();
      if (!currentVrm) return null;
      const humanoid = currentVrm.humanoid;
      const left = humanoid?.getNormalizedBoneNode("leftHand");
      const right = humanoid?.getNormalizedBoneNode("rightHand");
      if (!left || !right) return null;
      const w = mountWidth();
      const h = mountHeight();
      camera.updateMatrixWorld();
      const project = (bone: THREE.Object3D) =>
        projectToScreen(bone.getWorldPosition(new THREE.Vector3()), camera, w, h);
      const leftPx = project(left);
      const rightPx = project(right);
      if (!leftPx || !rightPx) return null;
      return {
        left: { x: leftPx.x, y: leftPx.y },
        right: { x: rightPx.x, y: rightPx.y },
      };
    },
    getPxPerMetre() {
      const modelBox = getModelBox();
      if (!getVrm() || !modelBox) return null;
      return pxPerMetre(camera, modelBox, mountHeight());
    },
  };
}
