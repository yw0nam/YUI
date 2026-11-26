/** yui_run: runs the backend's JavaScript against the yui API in the sandbox and answers its JSON result. */

import { isPlainObject } from "../../../../settings/persisted-store";
import type { ClientTool, ClientToolDefinition } from "../client-tools";
import { createImageTable } from "./images";
import type { InfoDoc } from "./info-api";
import { type HostApi, runScript, type ScriptHost } from "./sandbox";
import type { SettingsApi, WriteResults } from "./settings-api";
import type { StateDoc } from "./state-api";

/** A namespace method: the run's signal first, then the script's arguments. */
export type YuiMethod = (signal: AbortSignal, ...args: unknown[]) => Promise<unknown>;
/** One yui namespace: its methods and its help() block. */
export type YuiNamespace = { methods: Record<string, YuiMethod>; declaration: string };
/** yui.plugins, which also reads a plugin skill for help() and lists the plugins for the description. */
export type PluginsNamespace = YuiNamespace & {
  skill(name: string): Promise<string>;
  listing(): string;
};

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

const DESCRIPTION =
  "Run JavaScript against YUI's yui API and get its result. Start with return help(): it returns the API as text. The code is an async function body: use await, and end with return and a JSON value.";

/** help() prints the namespace blocks in this order. */
const ORDER = ["guide", "terminal", "plugins", "look", "threads"] as const;
/** The namespaces whose calls name the status pill. */
const REPORTED = new Set<string>(["look", "threads", "terminal"]);

export function createYuiRunTool(ports: YuiRunPorts): ClientTool {
  const present = ORDER.filter((name) => ports.namespaces[name]);
  return {
    name: "yui_run",
    // A getter: each read lists the plugins enabled at that moment.
    get definition(): ClientToolDefinition {
      const listing = ports.namespaces.plugins?.listing() ?? "";
      return {
        type: "function",
        function: {
          name: "yui_run",
          description: listing ? `${DESCRIPTION} ${listing}` : DESCRIPTION,
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
      const bind = (name: string, namespace: YuiNamespace): HostApi =>
        Object.fromEntries(
          Object.entries(namespace.methods).map(([method, fn]) => [
            method,
            async (...callArgs: unknown[]) => {
              if (REPORTED.has(name)) call?.status?.(name);
              else if (name === "plugins" && method === "call" && typeof callArgs[0] === "string")
                call?.status?.(callArgs[0]);
              const result = await fn(stop, ...callArgs);
              const made = isPlainObject(result) && (result as { images?: unknown }).images;
              return Array.isArray(made) && made.every((url) => typeof url === "string")
                ? { ...(result as object), images: images.keep(made) }
                : result;
            },
          ]),
        );
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
          ...Object.fromEntries(present.map((name) => [name, bind(name, ports.namespaces[name]!)])),
        },
        help: async (topic) => {
          if (topic === undefined || topic === null) {
            return ports.help(present.map((name) => ports.namespaces[name]!.declaration));
          }
          const plugins = ports.namespaces.plugins;
          if (typeof topic === "string" && topic.startsWith("plugin:") && plugins) {
            return plugins.skill(topic.slice("plugin:".length));
          }
          throw new TypeError("help: topic must be plugin:<name>");
        },
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
