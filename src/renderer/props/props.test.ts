/**
 * props.test.ts — furniture prop loading, fading, bounds and following.
 *
 * Plain three.js objects and a fake loader; no WebGL.
 */

import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../logger";
import { createProps } from "./props";

async function createFixture() {
  const map = new THREE.Texture();
  const shared = new THREE.MeshStandardMaterial({ map });
  const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.8 });
  const box = new THREE.BoxGeometry(2, 1, 4);
  const slab = new THREE.BoxGeometry(1, 1, 1);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(box, shared), new THREE.Mesh(slab, [shared, glass]));

  const scene = new THREE.Scene();
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies Logger;
  const props = createProps({ scene, loader: { loadAsync: async () => ({ scene: root }) }, log });
  const prop = await props.load("/props/bed.glb");
  return { box, glass, map, prop, props, root, scene, shared, slab };
}

function fakeVrm(metaVersion: "0" | "1", yaw: number): VRM {
  const scene = new THREE.Object3D();
  scene.position.set(0.4, -0.2, 0.1);
  scene.rotation.y = yaw;
  return { scene, meta: { metaVersion } } as unknown as VRM;
}

describe("createProps", () => {
  it("fades every unique material and restores its original values at full opacity", async () => {
    const { glass, prop, shared } = await createFixture();

    prop.setOpacity(0.5);

    expect(shared).toMatchObject({ transparent: true, opacity: 0.5, depthWrite: false });
    expect(glass).toMatchObject({ transparent: true, opacity: 0.4, depthWrite: false });

    prop.setOpacity(1);

    expect(shared).toMatchObject({ transparent: false, opacity: 1, depthWrite: true });
    expect(glass).toMatchObject({ transparent: true, opacity: 0.8, depthWrite: true });
  });

  it("dispose removes the root and releases each geometry, texture and material once", async () => {
    const { box, glass, map, prop, root, scene, shared, slab } = await createFixture();
    const spies = [box, slab, map, shared, glass].map((resource) => vi.spyOn(resource, "dispose"));

    prop.dispose();
    prop.dispose();

    expect(scene.children).not.toContain(root);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("bounds scale with setScale", async () => {
    const { prop } = await createFixture();

    expect(prop.bounds()).toMatchObject({
      min: { x: -1, y: -0.5, z: -2 },
      max: { x: 1, y: 0.5, z: 2 },
    });

    prop.setScale(2);

    expect(prop.bounds()).toMatchObject({
      min: { x: -2, y: -1, z: -4 },
      max: { x: 2, y: 1, z: 4 },
    });
  });

  it("step keeps a prop at the character's position, facing the way the clip was authored", async () => {
    const { props, root } = await createFixture();

    const vrm0 = fakeVrm("0", Math.PI);
    props.step(vrm0);

    expect(root.position).toEqual(vrm0.scene.position);
    expect(root.rotation.y).toBe(0);

    props.step(fakeVrm("1", 0.3));

    expect(root.rotation.y).toBe(0.3);
  });
});
