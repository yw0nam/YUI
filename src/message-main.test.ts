// @vitest-environment jsdom
/**
 * message-main.test.ts — the popped-out window carries the delegation chip.
 *
 * The socket lives in the pet window, so this window mirrors its state and its delegations list
 * over the cross-window bridge and draws the same chip beside the name plate. Only push mode has
 * a transport to report on, and only a state the pet window actually sent is worth drawing.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./styles.css", () => ({}));
vi.mock("./ui/message-window.css", () => ({}));
vi.mock("./ui/surfaces.css", () => ({}));
vi.mock("./ui/tokens.css", () => ({}));
vi.mock("./ui/delegation-chip.css", () => ({}));
vi.mock("./ui/delegation-rows.css", () => ({}));

import { createMessageBridge, type MessageControlOp } from "./io/message-bridge";
import type { DelegationItem, PushSocketState } from "./io/push-socket";
import { createSettingsBridge, type SettingsBridge } from "./io/settings-bridge";
import { setLocale, t } from "./ui/i18n";

const NOW = 1_789_365_900_000;

function running(id: string): DelegationItem {
  return { id, title: `work ${id}`, started_at: NOW - 60_000, state: "running" };
}

let petBridge: SettingsBridge;

/** The chat protocol the window reads out of the shared endpoint overrides. */
function setChatApi(api: string): void {
  localStorage.setItem("yui.endpoints", JSON.stringify({ chat_api: api }));
}

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
  localStorage.clear();
  setChatApi("push");
  petBridge = createSettingsBridge(undefined, { windowKind: "pet" });
});

afterEach(() => {
  petBridge.dispose();
  window.dispatchEvent(new Event("beforeunload"));
  document.body.innerHTML = "";
  localStorage.clear();
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

  await vi.waitFor(() => expect(label()).toBe(t("deleg.chip_lost")));
  expect(chipEl().classList.contains("is-lost")).toBe(true);
  expect(chipEl().hidden).toBe(false);
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

  await vi.waitFor(() => expect(chipEl().classList.contains("is-lost")).toBe(false));
  expect(chipEl().hidden).toBe(true);
});

it("stays bare until the pet window answers where the socket stands", async () => {
  await boot();

  expect(chipEl().hidden).toBe(true);
});

it("shows no chip while the protocol is not push", async () => {
  setChatApi("chat_completions");
  await boot();

  answer({ kind: "reconnecting", delay_ms: 4_000 });

  await vi.waitFor(() => expect(chipEl().classList.contains("is-lost")).toBe(true));
  expect(chipEl().hidden).toBe(true);
});

it("shows the chip once a settings change turns push on", async () => {
  setChatApi("chat_completions");
  await boot();
  answer({ kind: "reconnecting", delay_ms: 4_000 });
  await vi.waitFor(() => expect(chipEl().classList.contains("is-lost")).toBe(true));
  expect(chipEl().hidden).toBe(true);

  setChatApi("push");
  petBridge.emitSettingsChanged();

  await vi.waitFor(() => expect(chipEl().hidden).toBe(false));
  expect(label()).toBe(t("deleg.chip_lost"));
});

it("asks the character window for the settings surface when the lost chip is tapped", async () => {
  const petMessageBridge = createMessageBridge(undefined, { windowKind: "pet" });
  const seen: MessageControlOp[] = [];
  petMessageBridge.onControl((op) => seen.push(op));
  await boot();
  answer({ kind: "reconnecting", delay_ms: 4_000 });
  await vi.waitFor(() => expect(chipEl().hidden).toBe(false));

  document.querySelector<HTMLButtonElement>(".yui-deleg__chip")!.click();

  await vi.waitFor(() => expect(seen.map((op) => op.op)).toContain("open-settings"));
  petMessageBridge.dispose();
});
