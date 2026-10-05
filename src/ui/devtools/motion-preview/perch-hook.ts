import type { Renderer } from "../../../renderer";

export function installPerchHook(renderer: Renderer): void {
  // dev-only perch hook: drive setPerchTarget from Playwright / console.
  //   window.__perch(yPx) → pin the seat to that pet-window-local y line.
  //   window.__perch(null) → exit perch, restore idle framing.
  //   window.__perchProbe() → one-shot seat/charH probe.
  Object.assign(globalThis as Record<string, unknown>, {
    __perch: (yPx: number | null): void =>
      renderer.setPerchTarget(yPx === null ? null : { edgeLocalYpx: yPx }),
    __perchProbe: () => renderer.getPerchProbe(),
    __yuiRenderer: renderer,
  });
}
