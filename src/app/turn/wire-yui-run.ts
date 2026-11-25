/** Builds the ports a yui_run script reaches from this window's stores, ask queue and Tauri commands. */

import type { YuiRunPorts } from "../../io/chat/tools/run/yui-run-tool";

export function wireYuiRun(_deps: object): YuiRunPorts {
  return {
    settings: { read: () => ({}), write: async () => ({}) },
    state: async () => ({
      running_since: "",
      last_together: null,
      characters: [],
      permissions: { screen_recording: "unknown" },
    }),
    info: async () => ({ bodies: [], voices: [], monitors: [] }),
    help: () => "",
  };
}
