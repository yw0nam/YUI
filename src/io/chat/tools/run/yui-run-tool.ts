/** yui_run: runs the backend's JavaScript against the yui API in the sandbox and answers its JSON result. */

import type { ClientTool } from "../client-tools";
import type { InfoDoc } from "./info-api";
import type { SettingsApi } from "./settings-api";
import type { StateDoc } from "./state-api";

export interface YuiRunPorts {
  settings: SettingsApi;
  state(): Promise<StateDoc>;
  info(): Promise<InfoDoc>;
  help(): string;
}

export function createYuiRunTool(_ports: YuiRunPorts): ClientTool {
  return {
    name: "yui_run",
    definition: {
      type: "function",
      function: {
        name: "yui_run",
        description: "",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    execute: async () => '{"status":"error","error":"not implemented","logs":[]}',
    waitMs: 0,
  };
}
