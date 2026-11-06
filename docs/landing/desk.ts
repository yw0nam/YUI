import { desk, stage } from "./shared/dom";
export let LW = 1440,
  LH = 900,
  K = 1;
export const floorY = () => LH - 28;
export function fitDesk() {
  const vw = stage.clientWidth,
    vh = stage.clientHeight;
  K = Math.min(1, vw / (vw < vh ? 760 : 1200), vh / 820);
  LW = Math.round(vw / K);
  LH = Math.round(vh / K);
  desk.style.width = LW + "px";
  desk.style.height = LH + "px";
  desk.style.transform = `scale(${K})`;
}
export const toDesk = (e: { clientX: number; clientY: number }) => {
  const r = desk.getBoundingClientRect();
  return { x: (e.clientX - r.left) / K, y: (e.clientY - r.top) / K };
};
export const deskRect = (el: Element) => {
  const r = el.getBoundingClientRect(),
    d = desk.getBoundingClientRect();
  return {
    l: (r.left - d.left) / K,
    t: (r.top - d.top) / K,
    r: (r.right - d.left) / K,
    b: (r.bottom - d.top) / K,
  };
};
