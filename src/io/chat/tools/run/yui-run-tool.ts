/** yui_run: runs the backend's JavaScript against the yui API in the sandbox and answers its JSON result. */

import type { ClientTool } from "../client-tools";
import type { InfoDoc } from "./info-api";
import { runScript, type ScriptHost } from "./sandbox";
import type { SettingsApi } from "./settings-api";
import type { StateDoc } from "./state-api";

export interface YuiRunPorts {
  settings: SettingsApi;
  state(): Promise<StateDoc>;
  info(): Promise<InfoDoc>;
  help(): string;
}

const DESCRIPTION =
  "Run JavaScript against YUI's yui API and get its result. Call help() first: it prints the API. The code is an async function body: use await and return a JSON value.";

export function createYuiRunTool(ports: YuiRunPorts): ClientTool {
  return {
    name: "yui_run",
    definition: {
      type: "function",
      function: {
        name: "yui_run",
        description: DESCRIPTION,
        parameters: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"],
          additionalProperties: false,
        },
      },
    },
    waitMs: 121_000,
    execute: async (args, signal) => {
      const code = args.code;
      if (typeof code !== "string") {
        return JSON.stringify({ status: "error", error: "code must be a string", logs: [] });
      }
      const stop = signal ?? new AbortController().signal;
      const host: ScriptHost = {
        yui: {
          settings: {
            read: async () => ports.settings.read(),
            write: async (...call: unknown[]) =>
              ports.settings.write(
                call[0] as object,
                (call[1] as { why?: string } | undefined)?.why,
                stop,
              ),
          },
          state: { read: async () => ports.state() },
          info: { read: async () => ports.info() },
        },
        help: ports.help,
      };
      return JSON.stringify(await runScript(code, host, stop));
    },
    failed: (text) => {
      if (text.startsWith("error:")) return true;
      try {
        return (JSON.parse(text) as { status?: string }).status === "error";
      } catch {
        return false;
      }
    },
  };
}
