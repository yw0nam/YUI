import { type VRM, type VRMHumanBoneName, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
} from "@pixiv/three-vrm-animation";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import clip0 from "../../../public/motions/calm.vrma?url";
import clip4 from "../../../public/motions/drag.vrma?url";
import clip5 from "../../../public/motions/falling.vrma?url";
import clip16 from "../../../public/motions/happy.vrma?url";
import clip1 from "../../../public/motions/idle_01.vrma?url";
import clip2 from "../../../public/motions/idle_04.vrma?url";
import clip17 from "../../../public/motions/idle_10.vrma?url";
import clip3 from "../../../public/motions/idle_12.vrma?url";
import clip6 from "../../../public/motions/landing.vrma?url";
import clip7 from "../../../public/motions/peek.vrma?url";
import clip9 from "../../../public/motions/sit_01.vrma?url";
import clip10 from "../../../public/motions/sit_02.vrma?url";
import clip11 from "../../../public/motions/sit_03.vrma?url";
import clip12 from "../../../public/motions/sit_04.vrma?url";
import clip13 from "../../../public/motions/sit_05.vrma?url";
import clip14 from "../../../public/motions/suwari1.vrma?url";
import clip15 from "../../../public/motions/suwari3.vrma?url";
import clip8 from "../../../public/motions/walk.vrma?url";
import modelUrl from "../assets/yui-landing.vrm?url";
import { $, DEG } from "../shared/dom";
import { resize, scene } from "./renderer";

const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));
loader.register((p) => new VRMAnimationLoaderPlugin(p));
const CLIPS = [
  "calm",
  "idle_01",
  "idle_04",
  "idle_12",
  "drag",
  "falling",
  "landing",
  "peek",
  "walk",
  "sit_01",
  "sit_02",
  "sit_03",
  "sit_04",
  "sit_05",
  "suwari1",
  "suwari3",
  "happy",
  "idle_10",
];
const CLIP_URLS = [
  clip0,
  clip1,
  clip2,
  clip3,
  clip4,
  clip5,
  clip6,
  clip7,
  clip8,
  clip9,
  clip10,
  clip11,
  clip12,
  clip13,
  clip14,
  clip15,
  clip16,
  clip17,
];
const prog = new Map<string, { loaded: number; total: number }>();
const loadBar = $("load").firstElementChild as HTMLElement;
function load(url: string) {
  return loader.loadAsync(url, (event) => {
    prog.set(url, { loaded: event.loaded, total: event.total });
    let loaded = 0,
      total = 0;
    for (const value of prog.values()) {
      loaded += value.loaded;
      total += value.total;
    }
    loadBar.style.transform = `scaleX(${total ? Math.min(1, loaded / total) : 0})`;
  });
}
const [gltf, ...anims] = await Promise.all([load(modelUrl), ...CLIP_URLS.map(load)]);
$("load").hidden = true;

export const vrm = gltf.userData.vrm as VRM;
export let S = 300,
  charH = 500;
export const boxC = new THREE.Vector3();
VRMUtils.removeUnnecessaryVertices(gltf.scene);
VRMUtils.combineSkeletons(gltf.scene);
VRMUtils.rotateVRM0(vrm);
vrm.scene.traverse((o) => {
  o.frustumCulled = false;
});
scene.add(vrm.scene);
vrm.scene.updateMatrixWorld(true);
{
  const box = new THREE.Box3().setFromObject(vrm.scene),
    size = box.getSize(new THREE.Vector3());
  box.getCenter(boxC);
  const tanV = Math.tan(15 * DEG),
    dist = Math.max(size.y / 2 / tanV, size.x / 2 / ((400 / 600) * tanV)) * 1.1;
  S = 300 / (dist * tanV);
}
const lookProxy = new VRMLookAtQuaternionProxy(vrm.lookAt!);
lookProxy.name = "lookAtQuaternionProxy";
vrm.scene.add(lookProxy);
vrm.lookAt!.autoUpdate = false;
export const N_ = (b: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(b)!,
  R_ = (b: VRMHumanBoneName) => vrm.humanoid.getRawBoneNode(b)!;
export const nNeck = N_("neck"),
  nHead = N_("head"),
  rHead = R_("head"),
  rHips = R_("hips");
export const v3 = new THREE.Vector3();
charH = (rHead.getWorldPosition(v3).y + 0.13) * S;
export const hipsH = rHips.getWorldPosition(v3).y * S;
export const baseYawY = vrm.scene.rotation.y;
export const pitchSign = vrm.meta?.metaVersion === "0" ? 1 : -1;
resize(S);
export const mixer = new THREE.AnimationMixer(vrm.scene);
const hipsTrack = `${N_("hips").name}.position`;
export const actions: Record<string, THREE.AnimationAction> = {};
const swap = new Map<string, string>();
for (const bone of Object.keys(vrm.humanoid.humanBones) as VRMHumanBoneName[]) {
  const other = bone.startsWith("left")
    ? "right" + bone.slice(4)
    : bone.startsWith("right")
      ? "left" + bone.slice(5)
      : null;
  const a = N_(bone),
    b = other && N_(other as VRMHumanBoneName);
  if (a && b) swap.set(a.name, b.name);
}
function mirrorClip(clip: THREE.AnimationClip) {
  const m = clip.clone();
  for (const tr of m.tracks) {
    const at = tr.name.lastIndexOf("."),
      node = tr.name.slice(0, at),
      prop = tr.name.slice(at);
    if (swap.has(node)) tr.name = swap.get(node) + prop;
    if (prop === ".quaternion")
      for (let i = 0; i < tr.values.length; i += 4) {
        tr.values[i + 1] *= -1;
        tr.values[i + 2] *= -1;
      }
    else if (prop === ".position") for (let i = 0; i < tr.values.length; i += 3) tr.values[i] *= -1;
  }
  return m;
}
CLIPS.forEach((name, i) => {
  const clip = createVRMAnimationClip(anims[i].userData.vrmAnimations[0], vrm);
  for (const tr of clip.tracks)
    if (tr.name === hipsTrack) {
      const v = tr.values,
        n = v.length / 3;
      let mx = 0,
        mz = 0;
      for (let k = 0; k < n; k++) {
        mx += v[k * 3];
        mz += v[k * 3 + 2];
      }
      mx /= n;
      mz /= n;
      for (let k = 0; k < n; k++) {
        v[k * 3] -= mx;
        v[k * 3 + 2] -= mz;
      }
    }
  actions[name] = mixer.clipAction(name === "peek" ? mirrorClip(clip) : clip);
});
