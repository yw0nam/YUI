/** The quick-card open request for a click: her on-screen extent plus the click's y. */

import type { QuickCardOpen } from "../../io/bridge/settings-bridge";
import type { Renderer } from "../../renderer";

export function quickCardRequest(deps: {
  renderer: Pick<Renderer, "getCharacterAnchor" | "getCharacterWidthPx">;
  point: { x: number; y: number };
  /** Main only: whether voice input is live right now. */
  listening?: boolean;
}): QuickCardOpen {
  const anchor = deps.renderer.getCharacterAnchor();
  // No anchor yet: the click's x stands for both edges of her.
  const centre = anchor?.x ?? deps.point.x;
  const half = anchor ? (deps.renderer.getCharacterWidthPx() ?? 0) / 2 : 0;
  return {
    left: centre - half,
    right: centre + half,
    y: deps.point.y,
    ...(deps.listening === undefined ? {} : { listening: deps.listening }),
  };
}
