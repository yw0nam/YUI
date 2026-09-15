// @vitest-environment jsdom
/**
 * message-main.test.ts — the popped-out window carries the delegation chip.
 *
 * The socket lives in the pet window, so this window mirrors its state and its delegations list
 * over the cross-window bridge and draws the same chip beside the name plate.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./styles.css", () => ({}));
vi.mock("./ui/message-window.css", () => ({}));
vi.mock("./ui/surfaces.css", () => ({}));
vi.mock("./ui/tokens.css", () => ({}));
vi.mock("./ui/delegation-chip.css", () => ({}));
vi.mock("./ui/delegation-rows.css", () => ({}));

import type { DelegationItem, PushSocketState } from "./io/push-socket";
import { createSettingsBridge, type SettingsBridge } from "./io/settings-bridge";
import { setLocale, t } from "./ui/i18n";

const NOW = 1_789_365_900_000;

function running(id: string): DelegationItem {
  return { id, title: `work ${id}`, started_at: NOW - 60_000, state: "running" };
}

let petBridge: SettingsBridge;

/** Boots the window and waits for the chip the bootstrap mounts. */
async function boot(): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  await import("./message-main");
  await vi.waitFor(() => expect(document.querySelector(".yui-deleg")).not.toBeNull());
}

function chipEl(): HTMLElement {
  return document.querySelector<HTMLElement>(".yui-deleg")!;
}

function label(): string {
  return document.querySelector<HTMLElement>(".yui-deleg__label")!.textContent ?? "";
}

/** The pet window answers the ask every mirror sends on creation, then pushes its own updates. */
function answer(state: PushSocketState, items: DelegationItem[] = []): void {
  petBridge.onPushStateAsk(() => petBridge.emitPushState(state));
  petBridge.onDelegationsAsk(() => petBridge.emitDelegations(items));
  petBridge.emitPushState(state);
  petBridge.emitDelegations(items);
}

beforeEach(() => {
  vi.resetModules();
  let rafId = 0;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return ++rafId;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  setLocale("en");
  petBridge = createSettingsBridge(undefined, { windowKind: "pet" });
});

afterEach(() => {
  petBridge.dispose();
  window.dispatchEvent(new Event("beforeunload"));
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  setLocale("en");
});

it("mounts the chip in the plate's row, to the plate's right", async () => {
  await boot();

  const row = document.querySelector<HTMLElement>(".yui-plate-row")!;
  const children = [...row.children];
  expect(children.map((el) => el.className.split(" ")[0])).toEqual(["yui-plate", "yui-deleg"]);
});

it("draws the lost pill while the mirrored socket is not ready", async () => {
  await boot();

  answer({ kind: "reconnecting", delay_ms: 4_000 });

  await vi.waitFor(() => expect(chipEl().classList.contains("is-lost")).toBe(true));
  expect(label()).toBe(t("deleg.chip_lost"));
});

it("draws the running count once the mirrored socket is ready", async () => {
  await boot();

  answer({ kind: "ready", chat_id: "yui-3f9a2c1d" }, [running("d-1"), running("d-2")]);

  await vi.waitFor(() => expect(label()).toBe(t("deleg.chip_running", { n: 2 })));
  expect(chipEl().hidden).toBe(false);
});

it("stays hidden while the socket is ready with nothing running", async () => {
  await boot();

  answer({ kind: "ready", chat_id: "yui-3f9a2c1d" });

  await vi.waitFor(() => expect(chipEl().hidden).toBe(true));
  expect(chipEl().classList.contains("is-lost")).toBe(false);
});
