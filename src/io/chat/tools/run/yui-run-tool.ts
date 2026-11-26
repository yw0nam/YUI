/** yui_run: runs the backend's JavaScript against the yui API in the sandbox and answers its JSON result. */

import { isPlainObject } from "../../../../settings/persisted-store";
import type { ClientTool, ClientToolDefinition } from "../client-tools";
import { bindNamespace } from "./bind-namespace";
import { createHelp } from "./help-topic";
import { createImageTable } from "./images";
import type { InfoDoc } from "./info-api";
import type { PluginsNamespace, YuiNamespace } from "./namespace";
import { runScript, type ScriptHost } from "./sandbox";
import type { SettingsApi, WriteResults } from "./settings-api";
import type { StateDoc } from "./state-api";

export interface YuiRunPorts {
  settings: SettingsApi;
  state(): Promise<StateDoc>;
  info(): Promise<InfoDoc>;
  /** The help() text, holding the blocks of the namespaces present. */
  help(declarations: readonly string[]): string;
  /** The namespaces this window has; an absent one is absent from yui and from help(). */
  namespaces: {
    guide?: YuiNamespace;
    terminal?: YuiNamespace;
    plugins?: PluginsNamespace;
    look?: YuiNamespace;
    threads?: YuiNamespace;
  };
}

/** The ports a window builds itself; the namespaces join them where the tool is created. */
export type YuiRunWindowPorts = Omit<YuiRunPorts, "namespaces">;

const HOW =
  "Run JavaScript against YUI's yui API and get its result. Start with return help(): it returns the API as text. The code is an async function body: use await, and end with return and a JSON value.";

// Hermes's tool search shows only a description's first sentence, cut at 80 characters, so it names what the window can do.
const CAN = [
  ["look", "see the screen and body"],
  ["threads", "Threads"],
  ["terminal", "terminals"],
  ["plugins", "plugins"],
  ["guide", "guides"],
] as const;

/** help() prints the namespace blocks in this order. */
const ORDER = ["guide", "terminal", "plugins", "look", "threads"] as const;

export function createYuiRunTool(ports: YuiRunPorts): ClientTool {
  const present = ORDER.filter((name) => ports.namespaces[name]);
  const can = CAN.filter(([name]) => ports.namespaces[name]).map(([, words]) => words);
  const lead = `YUI: ${[...can, "settings"].join(", ")}.`;
  return {
    name: "yui_run",
    // A getter: each read lists the plugins enabled at that moment.
    get definition(): ClientToolDefinition {
      const listing = ports.namespaces.plugins?.listing() ?? "";
      return {
        type: "function",
        function: {
          name: "yui_run",
          description: [lead, HOW, listing].filter(Boolean).join(" "),
          parameters: {
            type: "object",
            properties: { code: { type: "string" } },
            required: ["code"],
            additionalProperties: false,
          },
        },
      };
    },
    waitMs: 121_000,
    localStatus: true,
    execute: async (args, signal, call) => {
      const code = args.code;
      if (typeof code !== "string") {
        return JSON.stringify({ status: "error", error: "code must be a string", logs: [] });
      }
      // Aborted when the run ends, so no yui call outlives it.
      const ended = new AbortController();
      const stop = signal ? AbortSignal.any([signal, ended.signal]) : ended.signal;
      const writes: WriteResults[] = [];
      const images = createImageTable();
      const run = { signal: stop, status: call?.status, keep: images.keep };
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
          ...Object.fromEntries(
            present.map((name) => [name, bindNamespace(name, ports.namespaces[name]!, run)]),
          ),
        },
        help: createHelp(
          () => ports.help(present.map((name) => ports.namespaces[name]!.declaration)),
          ports.namespaces.plugins,
        ),
      };
      const outcome = await runScript(code, host, stop).finally(() => ended.abort());
      // Every write's answers ride the envelope, so a script that drops them still reports the real ones.
      const envelope = { ...outcome, ...(writes.length > 0 ? { writes } : {}) };
      const attached = outcome.status === "completed" ? images.attach(outcome.result) : undefined;
      if (!attached || attached.handles.length === 0) return JSON.stringify(envelope);
      return {
        text: JSON.stringify({ ...envelope, images: attached.handles }),
        images: attached.images,
      };
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
