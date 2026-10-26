/** A preset's face: its photo, else a dot in a hue taken from its id. */

import "./avatar.css";
import type { PresetEntry } from "../../settings/preset/active-preset";
import type { PhotoCrop } from "../../settings/preset/photo-crop";

/** djb2 over the id, mod 360. */
export function hueOf(presetId: string): number {
  let h = 5381;
  for (const c of presetId) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return (h >>> 0) % 360;
}

const colorOf = (presetId: string): string =>
  `oklch(var(--yui-avatar-l) var(--yui-avatar-c) ${hueOf(presetId)})`;

/** Frames the image on `crop`; without one it shows centred. */
export function applyCrop(img: HTMLImageElement, crop: PhotoCrop | undefined): void {
  img.classList.toggle("is-cropped", crop !== undefined);
  for (const [name, v] of [
    ["x", crop?.x],
    ["y", crop?.y],
    ["size", crop?.size],
  ] as const) {
    if (v === undefined) img.style.removeProperty(`--yui-crop-${name}`);
    else img.style.setProperty(`--yui-crop-${name}`, String(v));
  }
}

export function avatarEl(entry: PresetEntry, sizePx: number): HTMLElement {
  const el = document.createElement("span");
  el.style.setProperty("--yui-uc-size", `${sizePx}px`);
  el.style.background = colorOf(entry.id);
  if (!entry.thumbnail) {
    el.className = "yui-uc__dot";
    return el;
  }
  el.className = "yui-uc__avatar";
  const img = document.createElement("img");
  img.alt = "";
  img.src = entry.thumbnail;
  applyCrop(img, entry.crop);
  el.append(img);
  return el;
}
