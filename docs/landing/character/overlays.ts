import { createSurfaces } from "../../../src/ui/surfaces/surfaces";
import { canvas, grab, petEl, term } from "../shared/dom";
import { rect } from "../shared/math";
import { proj, readBody } from "./body";
import { boxC, charH, R_, S, vrm } from "./load";
export const surfaces = createSurfaces({
  mount: petEl,
  tool: { showTool() {}, finishTool() {}, hideTool() {} },
  namePlate: true,
});
surfaces.plate.setName("Yui");
surfaces.plate.setFace({ id: "yui", name: "Yui" });
const pet = { x: 0, y: 0, width: 400, height: 600 };
const hitBones = (["head", "hips", "leftFoot", "rightFoot", "leftHand", "rightHand"] as const)
  .map(R_)
  .filter(Boolean);
export function overlays() {
  pet.x = Math.round(vrm.scene.position.x * S + boxC.x * S - 200);
  pet.y = Math.round(-vrm.scene.position.y * S - boxC.y * S - 300);
  petEl.style.transform = `translate(${pet.x}px, ${pet.y}px)`;
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  for (const b of hitBones) {
    const p = proj(b);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  y0 -= 0.12 * charH;
  x0 -= 22;
  x1 += 22;
  y1 += 8;
  const behind = readBody().state === "peek" || readBody().state === "walk";
  if (behind) x0 = Math.max(x0, rect(term).r);
  canvas.classList.toggle("behind", behind);
  grab.style.transform = `translate(${x0}px, ${y0}px)`;
  grab.style.width = `${Math.max(0, x1 - x0)}px`;
  grab.style.height = `${y1 - y0}px`;
}

export function readPet() {
  return { ...pet };
}
