/** yui.state: when YUI started, when the user was last present, which characters are open, what the OS permits. */

import type { PresetEntry } from "../../../../settings/preset/active-preset";

export type ScreenRecording = "granted" | "denied" | "unknown";

export interface StateDoc {
  running_since: string;
  last_together: string | null;
  characters: { name: string; open: boolean; me: boolean }[];
  permissions: { screen_recording: ScreenRecording };
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Epoch ms as ISO 8601 in the local wall clock, with the local offset. */
function iso(ms: number): string {
  const date = new Date(ms);
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function createStateApi(deps: {
  /** Epoch ms the process started. */
  startedAt(): Promise<number>;
  /** Epoch ms of the user's last presence; null before the first. */
  lastTogether(): number | null;
  presets(): PresetEntry[];
  openIds(): string[];
  selfId(): string;
  screenRecording(): Promise<string>;
}): () => Promise<StateDoc> {
  return async () => {
    const permission = await deps.screenRecording();
    const open = deps.openIds();
    const self = deps.selfId();
    const last = deps.lastTogether();
    return {
      running_since: iso(await deps.startedAt()),
      last_together: last === null ? null : iso(last),
      characters: deps.presets().map((preset) => ({
        name: preset.name,
        open: open.includes(preset.id),
        me: preset.id === self,
      })),
      permissions: {
        screen_recording:
          permission === "granted" || permission === "denied" ? permission : "unknown",
      },
    };
  };
}
