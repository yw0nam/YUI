/** Fixed ports for tests that run a yui_run script without real settings. */

import type { YuiRunPorts } from "./yui-run-tool";

export function stubYuiRunPorts(): YuiRunPorts {
  return {
    settings: { read: () => ({ bubble: { keep: false } }), write: async () => ({}) },
    state: async () => ({
      running_since: "2026-11-26T09:00:00+09:00",
      last_together: null,
      characters: [{ name: "Yui", open: true, me: true }],
      permissions: { screen_recording: "granted" },
    }),
    info: async () => ({ bodies: [], voices: [], monitors: [] }),
    help: () => "help text",
    namespaces: {},
  };
}
