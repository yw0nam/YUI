/** yui.info: the bodies, voices and monitors a setting can name. */

import type { MonitorInfo } from "../../../window/capture/screen-source-provider";

export interface InfoDoc {
  bodies: { id: string; label: string }[];
  voices: { id: string; label: string }[];
  monitors: { index: number; name?: string; width?: number; height?: number }[];
}

interface Option {
  id: string;
  label?: string;
}

export function createInfoApi(_deps: {
  bodies(): Option[];
  voices(): Option[];
  monitors(): Promise<MonitorInfo[]>;
}): () => Promise<InfoDoc> {
  return async () => ({ bodies: [], voices: [], monitors: [] });
}
