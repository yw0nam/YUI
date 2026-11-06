import * as THREE from "three";
import { fitDesk, K, LH, LW } from "../desk";
import { $, canvas } from "../shared/dom";
export const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
export const scene = new THREE.Scene();
export const cam = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
cam.position.z = 5;
const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
sun.position.set(0.5, 1, 1);
scene.add(sun);
export function resize(S: number) {
  fitDesk();
  canvas.style.width = LW + "px";
  canvas.style.height = LH + "px";
  renderer.setPixelRatio(Math.min(devicePixelRatio * K, 2));
  renderer.setSize(LW, LH, false);
  cam.left = 0;
  cam.right = LW / S;
  cam.top = 0;
  cam.bottom = -LH / S;
  cam.updateProjectionMatrix();
  $("arc").setAttribute("width", String(LW));
  $("arc").setAttribute("height", String(LH));
}
