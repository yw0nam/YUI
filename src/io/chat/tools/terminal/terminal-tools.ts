/** The terminal tools: the backend's side of the shared terminals, over the terminal commands. */

import { type ClientTool, TURN_STOPPED } from "../client-tools";

/** The Tauri invoke the tools run the terminal commands through; a port tests can pass in. */
export type TerminalInvoke = (command: string, args?: Record<string, unknown>) => Promise<string>;

/** Whether a result reads as a failure: an error, or the user's denial. */
function terminalFailed(text: string): boolean {
  return text.startsWith("error:") || text.startsWith("denied");
}

export function createTerminalTools(deps: {
  /** The preset of the calling window, sent with each call. */
  presetId: () => string | null;
  invoke: TerminalInvoke;
}): ClientTool[] {
  const invoke = deps.invoke;
  const presetId = deps.presetId;

  /** Runs a read or write off an Allow that may wait up to 60 s, cancelling it on turn stop. */
  const waiting = async (
    command: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> => {
    if (signal?.aborted) return TURN_STOPPED;
    const callId = crypto.randomUUID();
    const onAbort = (): void => {
      void invoke("terminal_tool_cancel", { callId }).catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await invoke(command, { callId, presetId: presetId(), ...args });
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };

  const open: ClientTool = {
    name: "terminal_open",
    definition: {
      type: "function" as const,
      function: {
        name: "terminal_open",
        description:
          "Open a new terminal (a shell YUI runs) and get its id. Opening needs no permission; optional cwd sets its working directory. Reading or writing any terminal still asks the user for Allow. List terminals with terminal_list.",
        parameters: {
          type: "object" as const,
          properties: {
            cwd: { type: "string", description: "Working directory to open in." },
          },
          additionalProperties: false as const,
        },
      },
    },
    execute: async (args) =>
      await invoke("terminal_tool_open", { presetId: presetId(), cwd: args.cwd }),
    waitMs: 5_000,
  };

  const list: ClientTool = {
    name: "terminal_list",
    definition: {
      type: "function" as const,
      function: {
        name: "terminal_list",
        description:
          "List every terminal, one per line: id | owner (you or a preset) | title | running or exited <code> | access: <presetId or none>. Needs no permission and shows no output — use an id with terminal_read after the user allows.",
        parameters: {
          type: "object" as const,
          properties: {},
          additionalProperties: false as const,
        },
      },
    },
    execute: async () => await invoke("terminal_tool_list"),
    waitMs: 5_000,
  };

  const read: ClientTool = {
    name: "terminal_read",
    definition: {
      type: "function" as const,
      function: {
        name: "terminal_read",
        description:
          "Read a terminal's rendered screen (id from terminal_list; lines defaults to 100, max 500). Reading any terminal asks the user for Allow and may wait up to 60 s. denied means the user said no — do not retry the same request in this turn.",
        parameters: {
          type: "object" as const,
          properties: {
            id: { type: "string", description: "The terminal's id." },
            lines: { type: "integer", description: "How many last lines to read, max 500." },
          },
          additionalProperties: false as const,
          required: ["id"],
        },
      },
    },
    execute: async (args, signal) =>
      await waiting("terminal_tool_read", { id: String(args.id ?? ""), lines: args.lines }, signal),
    waitMs: 70_000,
    localStatus: true,
    failed: terminalFailed,
  };

  const write: ClientTool = {
    name: "terminal_write",
    definition: {
      type: "function" as const,
      function: {
        name: "terminal_write",
        description:
          'Write text to a terminal (id from terminal_list); Enter is sent after it unless enter:false, and "\\u0003" sends Ctrl-C. Writing any terminal asks the user for Allow and may wait up to 60 s. denied means the user said no — do not retry in this turn. Read afterwards with terminal_read to see the output.',
        parameters: {
          type: "object" as const,
          properties: {
            id: { type: "string", description: "The terminal's id." },
            text: { type: "string", description: "The text to write, sent as given." },
            enter: { type: "boolean", description: "Press Enter after the text; default true." },
          },
          additionalProperties: false as const,
          required: ["id", "text"],
        },
      },
    },
    execute: async (args, signal) =>
      await waiting(
        "terminal_tool_write",
        { id: String(args.id ?? ""), text: String(args.text ?? ""), enter: args.enter },
        signal,
      ),
    waitMs: 70_000,
    localStatus: true,
    failed: terminalFailed,
  };

  const close: ClientTool = {
    name: "terminal_close",
    definition: {
      type: "function" as const,
      function: {
        name: "terminal_close",
        description:
          "Close a terminal you opened (id from terminal_list); closing needs no permission. error: not your terminal means the user opened it — only the user can close it.",
        parameters: {
          type: "object" as const,
          properties: {
            id: { type: "string", description: "The terminal's id." },
          },
          additionalProperties: false as const,
          required: ["id"],
        },
      },
    },
    execute: async (args) =>
      await invoke("terminal_tool_close", { presetId: presetId(), id: String(args.id ?? "") }),
    waitMs: 5_000,
  };

  return [open, list, read, write, close];
}
