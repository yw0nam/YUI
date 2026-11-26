/** The images one yui_run run made, kept behind handles, and the ones its returned value holds. */

import { isPlainObject } from "../../../../settings/persisted-store";

/** An image a yui call made; it reaches the model only when the returned value holds it. */
type ImageHandle = { image: number };

export function createImageTable() {
  const kept: string[] = [];
  return {
    /** Handles numbered from 1 up within the run. */
    keep: (dataUrls: string[]): ImageHandle[] => dataUrls.map((url) => ({ image: kept.push(url) })),
    /** The issued handles the value holds, ascending and each once, with their images. */
    attach: (value: unknown): { handles: number[]; images: string[] } => {
      const found = new Set<number>();
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (isPlainObject(node)) {
          const entry = node as Record<string, unknown>;
          const keys = Object.keys(entry);
          const image = entry.image;
          if (keys.length === 1 && typeof image === "number" && kept[image - 1] !== undefined) {
            found.add(image);
          } else Object.values(entry).forEach(walk);
        }
      };
      walk(value);
      const handles = [...found].sort((a, b) => a - b);
      return { handles, images: handles.map((handle) => kept[handle - 1]!) };
    },
  };
}
