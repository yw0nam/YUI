/**
 * Renderer — three.js + @pixiv/three-vrm 출력 레이어. (PRD F1 / concept.md §2.A)
 *
 * 현재 구현 범위 = #4 VRM 로드 + 핫스왑:
 *  - three.js scene/camera/light + rAF 루프 (vrm.update).
 *  - VRMLoaderPlugin으로 VRM 로드, VRMUtils 최적화, 투명 배경(펫 창 #7).
 *  - loadVRM 재호출 = 핫스왑 (기존 모델 deepDispose 후 교체).
 *
 * 미구현(별 이슈):
 *  - setEmotion(#6 emotion→expression) / playMotion(#5 VRMA) / applyDirective(#16).
 *  - Tier1 ambient blend(#10), 립싱크(#15).
 *
 * 근거: three-vrm 3.x 공식 예제(GLTFLoader.register(VRMLoaderPlugin) → gltf.userData.vrm,
 *       VRMUtils.removeUnnecessaryVertices/combineSkeletons/combineMorphs, deepDispose).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import type { ControlEnvelope, EmotionSignal, MotionSignal } from "../contract";

export interface RendererOptions {
  /** VRM을 렌더할 캔버스 마운트 대상. */
  mount: HTMLElement;
}

export interface Renderer {
  /** VRM 로드 또는 핫스왑 (#4). 기존 모델이 있으면 새 모델 준비 후 dispose하고 교체. */
  loadVRM(url: string): Promise<void>;
  /** contract.md §3 렌더 규약대로 render directive 적용. TODO(#16). */
  applyDirective(env: ControlEnvelope): void;
  /** emotion → expression 전이. TODO(#6). */
  setEmotion(emotion: EmotionSignal | null): void;
  /** motion registry 조회 후 재생. TODO(#5). */
  playMotion(motion: MotionSignal | null): void;
  /** rAF 루프 정지 + GPU 리소스 해제. */
  dispose(): void;
}

export function createRenderer(options: RendererOptions): Renderer {
  const { mount } = options;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0); // 투명 배경 — 펫 창(#7)에서 캐릭터만 보이게.
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // 펫 상반신 프레이밍: 살짝 위에서 정면.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.3, 1.6);
  camera.lookAt(new THREE.Vector3(0, 1.3, 0));

  const dir = new THREE.DirectionalLight(0xffffff, Math.PI);
  dir.position.set(1, 1, 1).normalize();
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.3));

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  let currentVrm: VRM | undefined;

  function resize(): void {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  const clock = new THREE.Clock();
  let rafId = 0;
  function animate(): void {
    rafId = requestAnimationFrame(animate);
    const dt = clock.getDelta();
    currentVrm?.update(dt);
    renderer.render(scene, camera);
  }
  animate();

  function disposeCurrent(): void {
    if (!currentVrm) return;
    scene.remove(currentVrm.scene);
    VRMUtils.deepDispose(currentVrm.scene);
    currentVrm = undefined;
  }

  async function loadVRM(url: string): Promise<void> {
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM;
    // 성능 최적화 (three-vrm 공식 권장).
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.combineMorphs(vrm);
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });
    VRMUtils.rotateVRM0(vrm); // VRM0.0이면 +Z 정면으로 회전, 1.0은 no-op.

    disposeCurrent(); // 핫스왑: 새 모델을 다 준비한 뒤 직전 모델 해제.
    currentVrm = vrm;
    scene.add(vrm.scene);
  }

  return {
    loadVRM,
    applyDirective(_env) {
      /* TODO(#16) */
    },
    setEmotion(_emotion) {
      /* TODO(#6) */
    },
    playMotion(_motion) {
      /* TODO(#5) */
    },
    dispose() {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      disposeCurrent();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
