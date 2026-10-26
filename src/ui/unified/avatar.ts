/** A preset's face in the unified chat window: its photo, else a dot in a hue taken from its id. */

import type { PresetEntry } from "../../settings/preset/active-preset";

/** djb2 over the id, mod 360. */
export function hueOf(presetId: string): number {
  let h = 5381;
  for (const c of presetId) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return (h >>> 0) % 360;
}

export const colorOf = (presetId: string): string =>
  `oklch(var(--yui-avatar-l) var(--yui-avatar-c) ${hueOf(presetId)})`;

export function avatarEl(entry: PresetEntry, sizePx: number): HTMLElement {
  const el = document.createElement(entry.thumbnail ? "img" : "span");
  el.style.setProperty("--yui-uc-size", `${sizePx}px`);
  if (entry.thumbnail) {
    el.className = "yui-uc__avatar";
    el.setAttribute("src", entry.thumbnail);
    el.setAttribute("alt", "");
  } else {
    el.className = "yui-uc__dot";
    el.style.background = colorOf(entry.id);
  }
  return el;
}
