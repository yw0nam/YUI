/**
 * The Threads window's grow and shrink: the panel clipped from the chip's rect to its own and back,
 * its content fading in after the grow, beside a jelly when asked, and out before the shrink. Under
 * reduced motion, or with no chip to grow from, it shows and hides at once.
 */

import { prefersReducedMotion } from "../../../ambient/liveliness/tier1";
import type { ScreenRect } from "../../../contract";
import { THREADS_PANEL_INSET_PX } from "../../../io/window/geometry/threads-position";

const GROW_MS = 280;
const FADE_IN_MS = 120;
const FADE_OUT_MS = 90;
const SHRINK_MS = 220;
const JELLY_MS = 560;
/** A timer floor past each animation's end, where a host pauses animations. */
const FLOOR_MS = 60;

export interface GrowParts {
  /** Shown while it carries `is-open`. */
  root: HTMLElement;
  panel: HTMLElement;
  content: HTMLElement;
}

export function run(
  el: HTMLElement,
  frames: Keyframe[],
  ms: number,
  easing = getComputedStyle(document.documentElement).getPropertyValue("--yui-ease").trim() ||
    "ease-out",
): Promise<void> {
  const done = el.animate(frames, { duration: ms, easing, fill: "forwards" }).finished;
  return Promise.race([
    done.then(
      () => {},
      () => {},
    ),
    new Promise<void>((resolve) => setTimeout(resolve, ms + FLOOR_MS)),
  ]);
}

/** `rect` (window-local px) as a clip of `panel`, round like a pill; null clips to the panel itself. */
function clip(panel: HTMLElement, rect: ScreenRect | null): string {
  if (!rect) return `inset(0px 0px 0px 0px round ${getComputedStyle(panel).borderTopLeftRadius})`;
  const box = panel.getBoundingClientRect();
  const top = Math.max(0, rect.y - box.top);
  const left = Math.max(0, rect.x - box.left);
  const right = Math.max(0, box.right - rect.x - rect.width);
  const bottom = Math.max(0, box.bottom - rect.y - rect.height);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round 999px)`;
}

/** A damped squash and stretch about the panel's top edge, at most the inset past each other edge. */
function jelly(panel: HTMLElement): Promise<void> {
  const { width, height } = panel.getBoundingClientRect();
  const ax = Math.min(0.04, (2 * THREADS_PANEL_INSET_PX) / width);
  const ay = Math.min(0.03, THREADS_PANEL_INSET_PX / height);
  const scale = (x: number, y: number) => ({ transform: `scale(${x}, ${y})` });
  panel.style.transformOrigin = "50% 0%";
  return run(
    panel,
    [
      scale(1, 1),
      { ...scale(1 + ax, 1 - (5 * ay) / 3), offset: 0.25 },
      { ...scale(1 - ax / 2, 1 + ay), offset: 0.5 },
      { ...scale(1 + ax / 4, 1 - ay / 3), offset: 0.75 },
      scale(1, 1),
    ],
    JELLY_MS,
    "ease-out",
  );
}

function settle({ panel, content }: GrowParts): void {
  for (const el of [panel, content]) for (const anim of el.getAnimations?.() ?? []) anim.cancel();
  content.style.opacity = "";
  panel.style.clipPath = "";
  panel.style.transformOrigin = "";
}

export async function growOpen(
  parts: GrowParts,
  from: ScreenRect | null,
  opts: { jelly?: boolean } = {},
): Promise<void> {
  const { root, panel, content } = parts;
  const animate = from !== null && !prefersReducedMotion() && typeof panel.animate === "function";
  if (animate) {
    panel.style.clipPath = clip(panel, from);
    content.style.opacity = "0";
  }
  root.classList.add("is-open");
  if (!animate) return;
  await run(panel, [{ clipPath: clip(panel, from) }, { clipPath: clip(panel, null) }], GROW_MS);
  await Promise.all([
    run(content, [{ opacity: 0 }, { opacity: 1 }], FADE_IN_MS),
    opts.jelly ? jelly(panel) : undefined,
  ]);
  settle(parts);
}

export async function shrinkClose(parts: GrowParts, to: ScreenRect | null): Promise<void> {
  const { root, panel, content } = parts;
  if (to !== null && !prefersReducedMotion() && typeof panel.animate === "function") {
    await run(content, [{ opacity: 1 }, { opacity: 0 }], FADE_OUT_MS);
    await run(panel, [{ clipPath: clip(panel, null) }, { clipPath: clip(panel, to) }], SHRINK_MS);
  }
  root.classList.remove("is-open");
  settle(parts);
}
