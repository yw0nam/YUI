/** The quick-card open request for a click: her on-screen extent plus the click's y. */

import type { QuickCardOpen } from "../../io/bridge/settings-bridge";
import type { Renderer } from "../../renderer";

export function quickCardRequest(deps: {
  renderer: Pick<Renderer, "getSilhouetteBounds" | "getCharacterAnchor" | "getCharacterWidthPx">;
  point: { x: number; y: number };
  /** Main only: whether voice input is live right now. */
  listening?: boolean;
}): QuickCardOpen {
  // Her drawn body; before the first alpha grab, the model box at her feet, else the click's x.
  const silhouette = deps.renderer.getSilhouetteBounds();
  const anchor = deps.renderer.getCharacterAnchor();
  const centre = anchor?.x ?? deps.point.x;
  const half = anchor ? (deps.renderer.getCharacterWidthPx() ?? 0) / 2 : 0;
  return {
    left: silhouette?.left ?? centre - half,
    right: silhouette?.right ?? centre + half,
    y: deps.point.y,
    ...(deps.listening === undefined ? {} : { listening: deps.listening }),
  };
}
