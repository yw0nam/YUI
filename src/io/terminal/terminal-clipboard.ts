/**
 * The system clipboard for the Terminal: OSC 52 reads and writes it through the Tauri clipboard
 * plugin. Every selection maps to the one system clipboard, because tmux sends an empty selection.
 */

import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { IClipboardProvider } from "@xterm/addon-clipboard";
import { createLogger } from "../../logger";

const log = createLogger("terminal-clipboard");

export const terminalClipboard: IClipboardProvider = {
  async readText(): Promise<string> {
    try {
      return await readText();
    } catch (error) {
      log.warn("clipboard_read_failed", { error: String(error) });
      return "";
    }
  },
  async writeText(_selection, text): Promise<void> {
    try {
      await writeText(text);
    } catch (error) {
      log.warn("clipboard_write_failed", { error: String(error) });
    }
  },
};
