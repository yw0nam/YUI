export const $ = <T extends HTMLElement | SVGElement = HTMLElement>(id: string) =>
  document.getElementById(id) as unknown as T;
export const stage = $("stage"),
  desk = $("desk"),
  canvas = $<HTMLCanvasElement>("gl"),
  grab = $("grab"),
  term = $("term"),
  petEl = $("pet"),
  threadsWin = $("threadsWin");
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const DEG = Math.PI / 180;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const rect = (w: HTMLElement) => ({
  l: w.offsetLeft,
  t: w.offsetTop,
  r: w.offsetLeft + w.offsetWidth,
  b: w.offsetTop + w.offsetHeight,
});
export const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();
