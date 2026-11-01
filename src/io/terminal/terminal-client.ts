/** The webview side of the terminal store: the newest snapshot and the user's terminal commands. */

import { Channel, invoke } from "@tauri-apps/api/core";
import type { TerminalSnapshot } from "../../contract";
import { isTauri } from "../../tauri-env";
import { createSnapshotFeed, type SnapshotFeed } from "../snapshot-feed/snapshot-feed";

export interface TerminalClient extends SnapshotFeed<TerminalSnapshot> {
  /** Opens a user terminal in the home folder and resolves its id; off Tauri it resolves the empty string. */
  open(): Promise<string>;
  close(id: string): Promise<void>;
  /** Keystrokes for the user to type into any terminal; never changes access. */
  input(id: string, data: string): Promise<void>;
  /** One size for every terminal and its parser. */
  resize(cols: number, rows: number): Promise<void>;
  /** Streams the terminal's screen-state bytes: the formatted state, then live output. */
  attach(id: string, onBytes: (bytes: Uint8Array) => void): Promise<void>;
  answer(requestId: string, allow: boolean): Promise<void>;
  takeBack(id: string): Promise<void>;
}

/** Runs `command` under Tauri; off Tauri it does nothing and resolves undefined. */
async function call<T = void>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  return isTauri() ? await invoke<T>(command, args) : undefined;
}

export function createTerminalClient(): TerminalClient {
  return {
    ...createSnapshotFeed<TerminalSnapshot>("terminal-snapshot", "terminal_snapshot"),
    open: async () => (await call<string>("terminal_open")) ?? "",
    close: async (id) => void (await call("terminal_close", { id })),
    input: async (id, data) => void (await call("terminal_input", { id, data })),
    resize: async (cols, rows) => void (await call("terminal_resize", { cols, rows })),
    async attach(id, onBytes) {
      // A Channel needs the Tauri runtime to exist at all.
      if (!isTauri()) return;
      const onOutput = new Channel<ArrayBuffer>();
      onOutput.onmessage = (buffer) => onBytes(new Uint8Array(buffer));
      await invoke<void>("terminal_attach", { id, onOutput });
    },
    answer: async (requestId, allow) => void (await call("terminal_answer", { requestId, allow })),
    takeBack: async (id) => void (await call("terminal_take_back", { id })),
  };
}
