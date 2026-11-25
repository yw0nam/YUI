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

export function createInfoApi(deps: {
  bodies(): Option[];
  voices(): Option[];
  monitors(): Promise<MonitorInfo[]>;
}): () => Promise<InfoDoc> {
  return async () => {
    const named = (options: Option[]) =>
      options.map((option) => ({ id: option.id, label: option.label ?? option.id }));
    const monitors = await deps.monitors();
    return {
      bodies: named(deps.bodies()),
      voices: named(deps.voices()),
      monitors: monitors.map((monitor) => ({
        index: monitor.index,
        ...(monitor.label !== undefined && { name: monitor.label }),
        ...(monitor.width !== undefined && { width: monitor.width }),
        ...(monitor.height !== undefined && { height: monitor.height }),
      })),
    };
  };
}
