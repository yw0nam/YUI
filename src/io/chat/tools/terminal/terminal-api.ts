/** yui.terminal: the backend's side of the shared terminals, over the terminal commands. */

import { TURN_STOPPED } from "../client-tools";

/** The Tauri invoke the methods run the terminal commands through; a port tests can pass in. */
export type TerminalInvoke = (command: string, args?: Record<string, unknown>) => Promise<string>;

// The line range Rust takes for `lines` (`Option<u32>`).
const MAX_LINES = 0xffffffff;

const TERMINAL_DECLARATION = `  terminal: {
    /** Opens a terminal this character owns, without asking: "opened <id> (<title>)" or "error: …". */
    open(opts?: { cwd?: string }): Promise<string>;
    /** One line per terminal: id | owner | title | running or exited <code> | access: <preset id or none>. */
    list(): Promise<string>;
    /** Its last lines (default 100, max 500). Asks the user's Allow, up to 60 s: "denied", "denied: no answer in 60 s" or "error: …" otherwise. */
    read(id: string, opts?: { lines?: number }): Promise<string>;
    /** Sends text, then Enter unless enter is false ("\\u0003" is Ctrl-C). Asks Allow like read: "ok", "denied…" or "error: …". */
    write(id: string, text: string, opts?: { enter?: boolean }): Promise<string>;
    /** Closes a terminal this character opened: "closed <id>" or "error: …". */
    close(id: string): Promise<string>;
  };`;

/** The script's options object: null counts as absent, anything but a plain object throws. */
function optionsOf(method: string, opts: unknown): Record<string, unknown> {
  if (opts === undefined || opts === null) return {};
  if (typeof opts !== "object" || Array.isArray(opts)) {
    throw new TypeError(`yui.terminal.${method}: opts must be an object`);
  }
  return opts as Record<string, unknown>;
}

function stringArg(method: string, name: string, value: unknown): string {
  if (typeof value !== "string")
    throw new TypeError(`yui.terminal.${method}: ${name} must be a string`);
  return value;
}

/** An optional field that is absent, null or of the right type; the typed value or undefined. */
function optional<T>(
  method: string,
  name: string,
  value: unknown,
  ok: (value: unknown) => value is T,
  want: string,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (!ok(value)) throw new TypeError(`yui.terminal.${method}: ${name} must be ${want}`);
  return value;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isLines = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_LINES;

export function createTerminalApi(deps: {
  /** The preset of the calling window, sent with each call. */
  presetId: () => string | null;
  invoke: TerminalInvoke;
}) {
  /** An invoke that rejects anyway is a failure, not a wrong argument: it answers as text. */
  const invokeAsText = async (...call: Parameters<TerminalInvoke>): Promise<string> => {
    try {
      return await deps.invoke(...call);
    } catch (error) {
      return `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  /** Runs a read or write off an Allow that may wait up to 60 s, cancelling it on turn stop. */
  const waiting = async (
    command: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> => {
    if (signal.aborted) return TURN_STOPPED;
    const callId = crypto.randomUUID();
    const onAbort = (): void => {
      void invokeAsText("terminal_tool_cancel", { callId });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await invokeAsText(command, { callId, presetId: deps.presetId(), ...args });
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };

  const methods = {
    open: async (_signal: AbortSignal, opts?: unknown) => {
      const cwd = optional("open", "cwd", optionsOf("open", opts).cwd, isString, "a string");
      return invokeAsText("terminal_tool_open", { presetId: deps.presetId(), cwd });
    },
    list: async (_signal: AbortSignal) => invokeAsText("terminal_tool_list"),
    read: async (signal: AbortSignal, id: unknown, opts?: unknown) => {
      const terminal = stringArg("read", "id", id);
      const lines = optional(
        "read",
        "lines",
        optionsOf("read", opts).lines,
        isLines,
        "an integer from 0 to 4294967295",
      );
      return waiting("terminal_tool_read", { id: terminal, lines }, signal);
    },
    write: async (signal: AbortSignal, id: unknown, text: unknown, opts?: unknown) => {
      const terminal = stringArg("write", "id", id);
      const sent = stringArg("write", "text", text);
      const enter = optional(
        "write",
        "enter",
        optionsOf("write", opts).enter,
        isBoolean,
        "a boolean",
      );
      return waiting("terminal_tool_write", { id: terminal, text: sent, enter }, signal);
    },
    close: async (_signal: AbortSignal, id: unknown) =>
      invokeAsText("terminal_tool_close", {
        presetId: deps.presetId(),
        id: stringArg("close", "id", id),
      }),
  };

  return { methods, declaration: TERMINAL_DECLARATION };
}
