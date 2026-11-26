/** yui_run: runs the backend's JavaScript against the yui API in the sandbox and answers its JSON result. */

import { isPlainObject } from "../../../../settings/persisted-store";
import type { ClientTool } from "../client-tools";
import type { InfoDoc } from "./info-api";
import { runScript, type ScriptHost } from "./sandbox";
import type { SettingsApi, WriteResults } from "./settings-api";
import type { StateDoc } from "./state-api";

export interface YuiRunPorts {
  settings: SettingsApi;
  state(): Promise<StateDoc>;
  info(): Promise<InfoDoc>;
  help(): string;
}

const DESCRIPTION =
  "Run JavaScript against YUI's yui API and get its result. Start with return help(): it returns the API as text. The code is an async function body: use await, and end with return and a JSON value.";

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
      const writes: WriteResults[] = [];
      const host: ScriptHost = {
        yui: {
          settings: {
            read: async () => ports.settings.read(),
            write: async (...call: unknown[]) => {
              const patch = call[0];
              const opts = call[1] as { why?: unknown } | undefined;
              const why = opts?.why;
              // Checked here, before any request: a bad shape must not reach the ask queue.
              const results = !isPlainObject(patch)
                ? ({ "*": "error: patch must be an object" } as WriteResults)
                : why !== undefined && typeof why !== "string"
                  ? ({ "*": "error: why must be a string" } as WriteResults)
                  : await ports.settings.write(patch as object, why as string | undefined, stop);
              writes.push(results);
              return results;
            },
          },
          state: { read: async () => ports.state() },
          info: { read: async () => ports.info() },
        },
        help: ports.help,
      };
      const outcome = await runScript(code, host, stop);
      // Every write's answers ride the envelope, so a script that drops them still reports the real ones.
      return JSON.stringify({ ...outcome, ...(writes.length > 0 ? { writes } : {}) });
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
