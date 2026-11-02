/** terminal-clipboard.test.ts — the Terminal's system clipboard: the OSC 52 read and write, and what a rejected plugin call does. */

import type { ClipboardSelectionType } from "@xterm/addon-clipboard";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readText: vi.fn<typeof import("@tauri-apps/plugin-clipboard-manager").readText>(),
  writeText: vi.fn<typeof import("@tauri-apps/plugin-clipboard-manager").writeText>(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: mocks.readText,
  writeText: mocks.writeText,
}));

import { terminalClipboard } from "./terminal-clipboard";

/** The system clipboard selection. */
const SYSTEM = "c" as ClipboardSelectionType;

it("resolves an empty string when the clipboard read is rejected", async () => {
  mocks.readText.mockRejectedValue(new Error("clipboard unavailable"));

  await expect(terminalClipboard.readText(SYSTEM)).resolves.toBe("");
});

it("resolves when the clipboard write is rejected", async () => {
  mocks.writeText.mockRejectedValue(new Error("clipboard unavailable"));

  await expect(terminalClipboard.writeText(SYSTEM, "안녕하세요")).resolves.toBeUndefined();
});
