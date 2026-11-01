// @vitest-environment jsdom
/** wire-threads-chip.test.ts — main's Threads chip seeds from the window's client, follows it, and stays marked expanded until the window's closed report. */

import { beforeEach, expect, it, vi } from "vitest";
import type { TerminalSnapshot, ThreadsSnapshot } from "../../contract";
import type { ThreadsClient } from "../../io/threads/threads-client";

vi.mock("../../ui/threads/chip/threads-chip.css", () => ({}));
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

function fakeClient(
  snapshot: ThreadsSnapshot | null,
): ThreadsClient & { fire(snapshot: ThreadsSnapshot): void } {
  let latest = snapshot;
  const listeners = new Set<(snapshot: ThreadsSnapshot) => void>();
  return {
    snapshot: () => latest,
    threads: () => latest?.threads ?? [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    answer: async () => {},
    dispose: () => {},
    fire(next) {
      latest = next;
      for (const listener of listeners) listener(next);
    },
  };
}

function snapshotOf(waiting: number): ThreadsSnapshot {
  return {
    revision: 1,
    threads: Array.from({ length: waiting }, (_, i) => ({
      id: `t${i}`,
      source: "codex",
      title: `t${i}`,
      state: "input-required",
      entries: [],
      created_at: 0,
      updated_at: 1,
    })),
  };
}

function bridge() {
  return {
    emitThreadsOpen: vi.fn(),
    onThreadsReady: (cb: () => void) => {
      ready.add(cb);
      return () => ready.delete(cb);
    },
    onThreadsClosed: (cb: () => void) => {
      closed.add(cb);
      return () => closed.delete(cb);
    },
  };
}
const closed = new Set<() => void>();
const ready = new Set<() => void>();

function terminalOf(requests: number): { snapshot(): TerminalSnapshot; subscribe(): () => void } {
  const snapshot: TerminalSnapshot = {
    revision: 1,
    terminals: [],
    requests: Array.from({ length: requests }, (_, i) => ({
      id: `r${i}`,
      terminalId: "t1",
      presetId: "yui",
      kind: "read" as const,
      text: null,
      deadline: 60_000,
    })),
  };
  return { snapshot: () => snapshot, subscribe: () => () => {} };
}

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  setLocale("en");
  document.body.innerHTML = "";
  closed.clear();
  ready.clear();
});

it("draws no chip without a client", () => {
  wireThreadsChip({
    client: null,
    mount: document.body,
    collapsed: createDelegationChipSettings(),
    bridge: bridge(),
    terminal: null,
    onTerminalOpen: () => () => {},
  });
  expect(document.querySelector(".yui-threadchip")).toBeNull();
});

it("seeds the chip from a preloaded client without a new snapshot", () => {
  const client = fakeClient(snapshotOf(2));
  wireThreadsChip({
    client,
    mount: document.body,
    collapsed: createDelegationChipSettings(),
    bridge: bridge(),
    terminal: null,
    onTerminalOpen: () => () => {},
  });
  const chip = document.querySelector<HTMLButtonElement>(".yui-threadchip")!;
  expect(chip.hidden).toBe(false);
  expect(chip.querySelector(".yui-threadchip__count")?.textContent).toBe("2");
});

it("does not nod on the first snapshot after a null seed", () => {
  const client = fakeClient(null);
  wireThreadsChip({
    client,
    mount: document.body,
    collapsed: createDelegationChipSettings(),
    bridge: bridge(),
    terminal: null,
    onTerminalOpen: () => () => {},
  });
  client.fire(snapshotOf(1));
  const chip = document.querySelector<HTMLButtonElement>(".yui-threadchip")!;
  expect(chip.hidden).toBe(false);
  expect(chip.querySelector(".yui-threadchip__count")?.textContent).toBe("1");
  expect(chip.classList.contains("is-nod")).toBe(false);
});

it("marks the chip expanded from its tap until the Threads window reports closed", async () => {
  const client = fakeClient(null);
  wireThreadsChip({
    client,
    mount: document.body,
    collapsed: createDelegationChipSettings(),
    bridge: bridge(),
    terminal: null,
    onTerminalOpen: () => () => {},
  });
  client.fire(snapshotOf(1));
  const chip = document.querySelector<HTMLButtonElement>(".yui-threadchip")!;
  expect(chip.hidden).toBe(false);

  chip.click();
  expect(chip.getAttribute("aria-expanded")).toBe("true");

  for (const cb of closed) cb();
  expect(chip.getAttribute("aria-expanded")).toBe("false");
});

it("counts a waiting access request and opens the Terminal tab while one waits", async () => {
  const b = bridge();
  wireThreadsChip({
    client: fakeClient(snapshotOf(1)),
    mount: document.body,
    collapsed: createDelegationChipSettings(),
    bridge: b,
    terminal: terminalOf(1),
    onTerminalOpen: () => () => {},
  });
  const chip = document.querySelector<HTMLButtonElement>(".yui-threadchip")!;
  expect(chip.querySelector(".yui-threadchip__count")?.textContent).toBe("2");

  chip.click();
  await vi.waitFor(() => expect(ready.size).toBe(1));
  for (const cb of ready) cb();

  await vi.waitFor(() =>
    expect(b.emitThreadsOpen).toHaveBeenCalledWith({
      chip: { x: 0, y: 0, width: 0, height: 0 },
      tab: "terminal",
    }),
  );
});

it("opens the Terminal tab with no chip rect on the tray's terminal open", async () => {
  const b = bridge();
  let trayOpen = () => {};
  wireThreadsChip({
    client: fakeClient(null),
    mount: document.body,
    collapsed: createDelegationChipSettings(),
    bridge: b,
    terminal: terminalOf(0),
    onTerminalOpen: (cb) => {
      trayOpen = cb;
      return () => {};
    },
  });

  trayOpen();
  for (const cb of ready) cb();

  await vi.waitFor(() => expect(b.emitThreadsOpen).toHaveBeenCalledWith({ tab: "terminal" }));
  expect(document.querySelector(".yui-threadchip")?.getAttribute("aria-expanded")).toBe("true");
});
