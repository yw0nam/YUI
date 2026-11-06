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
export const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();
