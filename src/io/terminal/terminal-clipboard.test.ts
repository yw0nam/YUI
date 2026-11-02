/** terminal-clipboard.test.ts — the Terminal's system clipboard: the OSC 52 read and write, an empty write that leaves the clipboard alone, and what a rejected plugin call does. */

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

/** The selection tmux sends with every OSC 52 frame: an empty one. */
const SELECTION = "" as ClipboardSelectionType;

it("resolves the plugin's text", async () => {
  mocks.readText.mockResolvedValue("복사된 텍스트");

  await expect(terminalClipboard.readText(SELECTION)).resolves.toBe("복사된 텍스트");
});

it("resolves an empty string when the clipboard read is rejected", async () => {
  mocks.readText.mockRejectedValue(new Error("clipboard unavailable"));

  await expect(terminalClipboard.readText(SELECTION)).resolves.toBe("");
});

it("writes the text to the plugin", async () => {
  await terminalClipboard.writeText(SELECTION, "안녕하세요");

  expect(mocks.writeText).toHaveBeenCalledWith("안녕하세요");
});

it("leaves the clipboard alone when the text is empty", async () => {
  await terminalClipboard.writeText(SELECTION, "");

  expect(mocks.writeText).not.toHaveBeenCalled();
});

it("resolves when the clipboard write is rejected", async () => {
  mocks.writeText.mockRejectedValue(new Error("clipboard unavailable"));

  await expect(terminalClipboard.writeText(SELECTION, "안녕하세요")).resolves.toBeUndefined();
});
