/**
 * Furniture props — glTF models that stand in the character's scene and follow her
 * position and facing each frame. A prop lives outside vrm.scene, so the model box,
 * the camera fit and the screen probes do not see it.
 */

import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { Logger } from "../../logger";
import type { PropHandle } from "../types";

interface PropsDeps {
  scene: THREE.Scene;
  loader: { loadAsync(url: string): Promise<{ scene: THREE.Object3D }> };
  log: Logger;
}

export interface Props {
  /** Load a glTF and add it to the scene at the character's position. */
  load(url: string): Promise<PropHandle>;
  /** Keep every live prop at the character's position, facing the way its clips were authored. */
  step(vrm: VRM): void;
  /** Dispose every live prop; a load still in flight resolves to a disposed handle. */
  disposeAll(): void;
}

export function createProps(deps: PropsDeps): Props {
  const { scene, loader, log } = deps;

  const live = new Map<THREE.Object3D, PropHandle>();
  let closed = false;

  async function load(url: string): Promise<PropHandle> {
    const { scene: root } = await loader.loadAsync(url);

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Map<
      THREE.Material,
      { transparent: boolean; opacity: number; depthWrite: boolean }
    >();
    root.traverse((obj) => {
      obj.frustumCulled = false;
      if (!(obj instanceof THREE.Mesh)) return;
      geometries.add(obj.geometry);
      for (const material of [obj.material].flat() as THREE.Material[]) {
        const { transparent, opacity, depthWrite } = material;
        if (!materials.has(material)) materials.set(material, { transparent, opacity, depthWrite });
      }
    });
    // Measured while the root still has its identity transform, so the box is local.
    const box = new THREE.Box3().setFromObject(root);

    const handle: PropHandle = {
      setScale(s) {
        if (Number.isFinite(s) && s > 0) root.scale.setScalar(s);
      },
      setOpacity(a) {
        const alpha = THREE.MathUtils.clamp(a, 0, 1);
        for (const [material, original] of materials) {
          const transparent = alpha < 1 || original.transparent;
          // The opaque shader variant writes alpha 1, so a flip needs a new program.
          if (material.transparent !== transparent) material.needsUpdate = true;
          material.transparent = transparent;
          material.depthWrite = alpha >= 1 && original.depthWrite;
          material.opacity = original.opacity * alpha;
        }
      },
      bounds() {
        const scale = root.scale.x;
        return {
          min: box.min.clone().multiplyScalar(scale),
          max: box.max.clone().multiplyScalar(scale),
        };
      },
      dispose() {
        if (!live.delete(root)) return;
        scene.remove(root);
        for (const geometry of geometries) geometry.dispose();
        const textures = new Set<THREE.Texture>();
        for (const material of materials.keys()) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) textures.add(value);
          }
          material.dispose();
        }
        for (const texture of textures) texture.dispose();
      },
    };

    scene.add(root);
    live.set(root, handle);
    if (closed) handle.dispose();
    else log.info("prop_loaded", { url });
    return handle;
  }

  function step(vrm: VRM): void {
    for (const root of live.keys()) {
      root.position.copy(vrm.scene.position);
      // rotateVRM0 turns a VRM0 scene by π and the retargeted clip is negated to match.
      root.rotation.y = vrm.scene.rotation.y - (vrm.meta.metaVersion === "0" ? Math.PI : 0);
    }
  }

  function disposeAll(): void {
    closed = true;
    for (const handle of [...live.values()]) handle.dispose();
  }

  return { load, step, disposeAll };
}
