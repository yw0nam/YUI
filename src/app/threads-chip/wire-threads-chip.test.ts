// @vitest-environment jsdom
/** wire-threads-chip.test.ts — main's Threads chip steps aside on its tap and shows again on the window's closed report. */

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../../ui/threads/chip/threads-chip.css", () => ({}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => ({
    revision: 1,
    threads: [
      {
        id: "t1",
        source: "codex",
        title: "t1",
        state: "input-required",
        entries: [],
        created_at: 0,
        updated_at: 1,
      },
    ],
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: Object.assign(
    vi.fn(
      class {
        once = vi.fn();
      },
    ),
    { getByLabel: async () => null },
  ),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    innerPosition: async () => ({ x: 0, y: 0 }),
    scaleFactor: async () => 1,
  }),
}));

import { createDelegationChipSettings } from "../../settings/panels/delegation-chip-settings";
import { setLocale } from "../../ui/i18n";
import { wireThreadsChip } from "./wire-threads-chip";

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  setLocale("en");
  document.body.innerHTML = "";
});

it("shows the chip again when the Threads window reports closed", async () => {
  const closed = new Set<() => void>();
  wireThreadsChip({
    boundId: null,
    mount: document.body,
    collapsed: createDelegationChipSettings(),
    bridge: {
      emitThreadsOpen: vi.fn(),
      onThreadsReady: () => () => {},
      onThreadsClosed: (cb) => {
        closed.add(cb);
        return () => closed.delete(cb);
      },
    },
  });
  const chip = document.querySelector<HTMLButtonElement>(".yui-threadchip")!;
  await vi.waitFor(() => expect(chip.hidden).toBe(false));

  chip.click();
  expect(chip.getAttribute("aria-expanded")).toBe("true");

  for (const cb of closed) cb();
  expect(chip.getAttribute("aria-expanded")).toBe("false");
});
