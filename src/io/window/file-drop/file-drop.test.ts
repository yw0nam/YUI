/**
 * file-drop.test.ts — this webview's file drag events.
 *
 * Pins src/io/window/file-drop/file-drop.ts: the native drag-drop payloads map to enter,
 * drop and leave with their paths, `over` reaches no handler, and the unlisten is returned.
 */

import { describe, expect, it, vi } from "vitest";
import { type FileDropEvent, subscribeFileDrop } from "./file-drop";

type Webview = ReturnType<typeof import("@tauri-apps/api/webview").getCurrentWebview>;
type DragDropHandler = Parameters<Webview["onDragDropEvent"]>[0];

const { onDragDropEvent } = vi.hoisted(() => ({
  onDragDropEvent: vi.fn<Webview["onDragDropEvent"]>(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

describe("subscribeFileDrop", () => {
  it("maps enter, drop and leave, drops over, and returns the unlisten", async () => {
    const unlisten = vi.fn();
    let native: DragDropHandler | undefined;
    onDragDropEvent.mockImplementation(async (handler) => {
      native = handler;
      return unlisten;
    });
    const seen: FileDropEvent[] = [];

    const off = await subscribeFileDrop((e) => seen.push(e));
    const position = { x: 1, y: 2 };
    const emit = (payload: unknown) =>
      native?.({ event: "tauri://drag-drop", id: 1, payload } as Parameters<DragDropHandler>[0]);
    emit({ type: "enter", paths: ["/a/Mio.yui"], position });
    emit({ type: "over", position });
    emit({ type: "drop", paths: ["/a/Mio.yui"], position });
    emit({ type: "leave" });

    expect(seen).toEqual([
      { type: "enter", paths: ["/a/Mio.yui"] },
      { type: "drop", paths: ["/a/Mio.yui"] },
      { type: "leave" },
    ]);
    off();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
