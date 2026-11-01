/** The webview side of the terminal store: the newest snapshot and the user's terminal commands. */

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TerminalSnapshot } from "../../contract";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

const log = createLogger("terminal-client");

export interface TerminalClient {
  /** The highest-revision snapshot seen so far; null before the first one, and always off Tauri. */
  snapshot(): TerminalSnapshot | null;
  subscribe(listener: (snapshot: TerminalSnapshot) => void): () => void;
  /** Opens a user terminal and resolves its id; inert off Tauri, where it resolves the empty string. */
  open(cwd?: string): Promise<string>;
  close(id: string): Promise<void>;
  /** Keystrokes for the user to type into any terminal; never changes access. */
  input(id: string, data: string): Promise<void>;
  /** One size for every terminal and its parser. */
  resize(cols: number, rows: number): Promise<void>;
  /** Streams the terminal's screen-state bytes: the formatted state, then live output. */
  attach(id: string, onBytes: (bytes: Uint8Array) => void): Promise<void>;
  answer(requestId: string, allow: boolean): Promise<void>;
  takeBack(id: string): Promise<void>;
  dispose(): void;
}

export function createTerminalClient(): TerminalClient {
  let latest: TerminalSnapshot | null = null;
  const listeners = new Set<(snapshot: TerminalSnapshot) => void>();
  let unlisten: (() => void) | undefined;
  let disposed = false;

  // Event delivery can reorder snapshots, so only a higher revision replaces the kept one.
  const keep = (snapshot: TerminalSnapshot): void => {
    if (latest !== null && snapshot.revision <= latest.revision) return;
    latest = snapshot;
    for (const listener of listeners) listener(snapshot);
  };

  // The read follows the subscription, so no event is lost between the two.
  const read = (): void => {
    void invoke<TerminalSnapshot>("terminal_snapshot").then(keep, (err) =>
      log.warn("snapshot.invoke_failed", { error: String(err) }),
    );
  };

  if (isTauri()) {
    void listen<TerminalSnapshot>("terminal-snapshot", (event) => keep(event.payload)).then(
      (stop) => {
        if (disposed) stop();
        else unlisten = stop;
        read();
      },
      (err) => {
        log.warn("snapshot.listen_failed", { error: String(err) });
        read();
      },
    );
  }

  return {
    snapshot: () => latest,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async open(cwd) {
      if (!isTauri()) return "";
      return await invoke<string>("terminal_open", { cwd });
    },
    async close(id) {
      if (!isTauri()) return;
      await invoke<void>("terminal_close", { id });
    },
    async input(id, data) {
      if (!isTauri()) return;
      await invoke<void>("terminal_input", { id, data });
    },
    async resize(cols, rows) {
      if (!isTauri()) return;
      await invoke<void>("terminal_resize", { cols, rows });
    },
    async attach(id, onBytes) {
      if (!isTauri()) return;
      const onOutput = new Channel<ArrayBuffer>();
      onOutput.onmessage = (buffer) => onBytes(new Uint8Array(buffer));
      await invoke<void>("terminal_attach", { id, onOutput });
    },
    async answer(requestId, allow) {
      if (!isTauri()) return;
      await invoke<void>("terminal_answer", { requestId, allow });
    },
    async takeBack(id) {
      if (!isTauri()) return;
      await invoke<void>("terminal_take_back", { id });
    },
    dispose() {
      disposed = true;
      unlisten?.();
    },
  };
}
