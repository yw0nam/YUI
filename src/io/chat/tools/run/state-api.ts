/** yui.state: when YUI started, when the user was last present, which characters are open, what the OS permits. */

import type { PresetEntry } from "../../../../settings/preset/active-preset";

export type ScreenRecording = "granted" | "denied" | "unknown";

export interface StateDoc {
  running_since: string;
  last_together: string | null;
  characters: { name: string; open: boolean; me: boolean }[];
  permissions: { screen_recording: ScreenRecording };
}

export function createStateApi(_deps: {
  /** Epoch ms the process started. */
  startedAt(): Promise<number>;
  /** Epoch ms of the user's last presence; null before the first. */
  lastTogether(): number | null;
  presets(): PresetEntry[];
  openIds(): string[];
  selfId(): string;
  screenRecording(): Promise<string>;
}): () => Promise<StateDoc> {
  return async () => ({
    running_since: "",
    last_together: "",
    characters: [],
    permissions: { screen_recording: "granted" },
  });
}
