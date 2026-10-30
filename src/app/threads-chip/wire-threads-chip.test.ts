// @vitest-environment jsdom
/** wire-threads-chip.test.ts — main's Threads chip seeds from the window's client, follows it, and stays marked expanded until the window's closed report. */

import { beforeEach, expect, it, vi } from "vitest";
import type { ThreadsSnapshot } from "../../contract";
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
    onThreadsReady: () => () => {},
    onThreadsClosed: (cb: () => void) => {
      closed.add(cb);
      return () => closed.delete(cb);
    },
  };
}
const closed = new Set<() => void>();

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  setLocale("en");
  document.body.innerHTML = "";
  closed.clear();
});

it("draws no chip without a client", () => {
  wireThreadsChip({
    client: null,
    mount: document.body,
    collapsed: createDelegationChipSettings(),
    bridge: bridge(),
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
  });
  client.fire(snapshotOf(1));
  const chip = document.querySelector<HTMLButtonElement>(".yui-threadchip")!;
  expect(chip.hidden).toBe(false);

  chip.click();
  expect(chip.getAttribute("aria-expanded")).toBe("true");

  for (const cb of closed) cb();
  expect(chip.getAttribute("aria-expanded")).toBe("false");
});
