import {
  VRM,
  VRMExpression,
  VRMExpressionManager,
  VRMExpressionMorphTargetBind,
} from "@pixiv/three-vrm";
import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { prepareVrm, readVrmMetaName } from "./vrm-loading";

const withMeta = (meta: unknown) => ({ meta }) as unknown as VRM;

describe("readVrmMetaName", () => {
  it("reads VRM1.0 meta.name, trimmed", () => {
    expect(readVrmMetaName(withMeta({ name: "  Yui " }))).toBe("Yui");
  });

  it("falls back to VRM0.0 meta.title", () => {
    expect(readVrmMetaName(withMeta({ title: "Old" }))).toBe("Old");
  });

  it("returns null when neither is a non-empty string", () => {
    expect(readVrmMetaName(withMeta({ name: "   " }))).toBeNull();
    expect(readVrmMetaName(withMeta(undefined))).toBeNull();
  });
});

// Builds a real VRM: one mesh with one morph target, one custom expression bound to it, an optional preset expression.
function buildVrm({
  metaVersion,
  custom,
  preset,
  isBinary,
}: {
  metaVersion: "0" | "1";
  custom: string;
  preset?: string;
  isBinary?: boolean;
}) {
  const geometry = new THREE.BoxGeometry();
  geometry.morphAttributes.position = [
    new THREE.BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 3), 3),
  ];
  const mesh = new THREE.Mesh(geometry);
  mesh.updateMorphTargets();
  const scene = new THREE.Group();
  scene.add(mesh);

  const manager = new VRMExpressionManager();
  let presetExpression: VRMExpression | undefined;
  if (preset != null) {
    presetExpression = new VRMExpression(preset);
    manager.registerExpression(presetExpression);
  }
  const customExpression = new VRMExpression(custom);
  if (isBinary) customExpression.isBinary = true;
  customExpression.addBind(
    new VRMExpressionMorphTargetBind({ primitives: [mesh], index: 0, weight: 1 }),
  );
  manager.registerExpression(customExpression);
  scene.add(customExpression);

  const vrm = new VRM({
    scene,
    meta: { metaVersion },
    humanoid: null,
    expressionManager: manager,
    firstPerson: null,
    lookAt: null,
  } as unknown as ConstructorParameters<typeof VRM>[0]);
  return { gltf: { scene, userData: { vrm } } as unknown as GLTF, mesh, scene, presetExpression };
}

describe("prepareVrm", () => {
  it.each<{
    caseName: string;
    metaVersion: "0" | "1";
    custom: string;
    preset?: string;
    keys: string[];
    driver: string;
    driverValue: number;
    influence: number;
    isBinary?: boolean;
    sceneName?: string;
  }>([
    {
      caseName: "reads a VRM 0.x custom Surprised as the surprised preset",
      metaVersion: "0",
      custom: "Surprised",
      keys: ["surprised"],
      driver: "surprised",
      driverValue: 0.4,
      influence: 0,
      isBinary: true,
      sceneName: "VRMExpression_surprised",
    },
    {
      caseName: "keeps a VRM 0.x custom Joy beside an existing happy preset",
      metaVersion: "0",
      custom: "Joy",
      preset: "happy",
      keys: ["Joy", "happy"],
      driver: "Joy",
      driverValue: 0.7,
      influence: 0.7,
    },
    {
      caseName: "leaves a VRM 1.0 custom Surprised alone",
      metaVersion: "1",
      custom: "Surprised",
      keys: ["Surprised"],
      driver: "Surprised",
      driverValue: 0.7,
      influence: 0.7,
    },
    {
      caseName: "keeps a VRM 0.x custom Constructor as a custom expression",
      metaVersion: "0",
      custom: "Constructor",
      keys: ["Constructor"],
      driver: "Constructor",
      driverValue: 0.7,
      influence: 0.7,
    },
  ])("$caseName", ({
    metaVersion,
    custom,
    preset,
    keys,
    driver,
    driverValue,
    influence,
    isBinary,
    sceneName,
  }) => {
    const { gltf, mesh, scene, presetExpression } = buildVrm({
      metaVersion,
      custom,
      preset,
      isBinary,
    });
    prepareVrm(gltf);
    const manager = (gltf.userData.vrm as VRM).expressionManager!;
    expect(Object.keys(manager.expressionMap).sort()).toEqual([...keys].sort());
    if (presetExpression != null) expect(manager.getExpression(preset!)).toBe(presetExpression);
    if (sceneName != null)
      expect(scene.getObjectByName(sceneName)).toBe(manager.getExpression(driver));
    manager.setValue(driver, driverValue);
    manager.update();
    expect(mesh.morphTargetInfluences?.[0]).toBe(influence);
  });
});
