/** The Threads panel's hop when a Thread reaction raises the window: a lift inside its transparent inset, a dip, and a settle. */

import { prefersReducedMotion } from "../../../ambient/liveliness/tier1";
import { THREADS_PANEL_INSET_PX } from "../../../io/window/geometry/threads-position";
import { run } from "./grow";

const HOP_MS = 480;

export async function hop(panel: HTMLElement): Promise<void> {
  if (prefersReducedMotion() || typeof panel.animate !== "function") return;
  await run(
    panel,
    [
      { transform: "translateY(0px)" },
      { transform: `translateY(-${THREADS_PANEL_INSET_PX}px)`, offset: 0.35 },
      { transform: "translateY(3px)", offset: 0.7 },
      { transform: "translateY(0px)" },
    ],
    HOP_MS,
    "ease-out",
  );
  // The end frame is the panel at rest; cancelling drops the held fill.
  for (const anim of panel.getAnimations?.() ?? []) anim.cancel();
}
