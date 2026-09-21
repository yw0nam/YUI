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
vi.mock("./ui/message/message-window.css", () => ({}));
vi.mock("./ui/surfaces/surfaces.css", () => ({}));
vi.mock("./ui/tokens.css", () => ({}));
vi.mock("./ui/chips/delegation-chip.css", () => ({}));
vi.mock("./ui/chips/delegation-rows.css", () => ({}));
vi.mock("./ui/chips/reasoning-chip.css", () => ({}));

import { createMessageBridge, type MessageControlOp } from "./io/bridge/message-bridge";
import type { ReasoningState } from "./io/bridge/reasoning-store";
import { createSettingsBridge, type SettingsBridge } from "./io/bridge/settings-bridge";
import type { DelegationItem, PushSocketState } from "./io/chat/push-socket";
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

function thinkEl(): HTMLElement {
  return document.querySelector<HTMLElement>(".yui-think")!;
}

function thinkPanel(): HTMLElement {
  return document.querySelector<HTMLElement>(".yui-think__panel")!;
}

function delegList(): HTMLElement {
  return document.querySelector<HTMLElement>(".yui-deleg__list")!;
}

function delegChipButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(".yui-deleg__chip")!;
}

/** The pet window answers the ask every mirror sends on creation, then pushes its own updates. */
function answer(state: PushSocketState, items: DelegationItem[] = []): void {
  petBridge.onPushStateAsk(() => petBridge.emitPushState(state));
  petBridge.onDelegationsAsk(() => petBridge.emitDelegations(items));
  petBridge.emitPushState(state);
  petBridge.emitDelegations(items);
}

/** The pet window answers the reasoning ask the mirror sends on creation, then pushes its own state. */
function answerReasoning(state: ReasoningState): void {
  petBridge.onReasoningAsk(() => petBridge.emitReasoning(state));
  petBridge.emitReasoning(state);
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

it("mounts the plate, the delegation chip and the reasoning chip in the plate's row", async () => {
  await boot();

  const row = document.querySelector<HTMLElement>(".yui-plate-row")!;
  const children = [...row.children];
  expect(children.map((el) => el.className.split(" ")[0])).toEqual([
    "yui-plate",
    "yui-deleg",
    "yui-think",
  ]);
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

// The reasoning chip lives on the same plate row; it draws the mirror's text in every mode.
it("shows the reasoning chip when the mirror carries reasoning text in push mode", async () => {
  await boot();
  answer({ kind: "ready", chat_id: "yui-3f9a2c1d" });
  answerReasoning({ text: "checking the logs", live: true });

  await vi.waitFor(() => expect(thinkEl().hidden).toBe(false));
  expect(thinkPanel().hidden).toBe(false);
  expect(document.querySelector<HTMLElement>(".yui-think__text")!.textContent).toBe(
    "checking the logs",
  );
});

it("shows the reasoning chip before any push state arrives, while the delegation chip still waits", async () => {
  await boot();

  answerReasoning({ text: "too early", live: true });

  await vi.waitFor(() => expect(thinkEl().hidden).toBe(false));
  expect(chipEl().hidden).toBe(true);
});

it("shows the reasoning chip while the protocol is not push, and still hides the delegation chip", async () => {
  setChatApi("chat_completions");
  await boot();
  answer({ kind: "reconnecting", delay_ms: 4_000 });

  answerReasoning({ text: "hmm", live: true });

  await vi.waitFor(() => expect(chipEl().classList.contains("is-lost")).toBe(true));
  expect(chipEl().hidden).toBe(true);
  await vi.waitFor(() => expect(thinkEl().hidden).toBe(false));
});

it("keeps the reasoning chip when the protocol leaves push, and hides the delegation chip", async () => {
  await boot();
  answer({ kind: "reconnecting", delay_ms: 4_000 });
  answerReasoning({ text: "hmm", live: true });
  await vi.waitFor(() => expect(chipEl().hidden).toBe(false));
  await vi.waitFor(() => expect(thinkEl().hidden).toBe(false));

  setChatApi("responses");
  petBridge.emitSettingsChanged();
  await vi.waitFor(() => expect(chipEl().hidden).toBe(true));

  expect(thinkEl().hidden).toBe(false);
});

it("closes the delegation list when a live reasoning state arrives", async () => {
  await boot();
  answer({ kind: "ready", chat_id: "yui-3f9a2c1d" }, [running("d-1")]);
  await vi.waitFor(() => expect(chipEl().hidden).toBe(false));
  delegChipButton().click();
  expect(delegList().hidden).toBe(false);

  answerReasoning({ text: "hmm", live: true });

  await vi.waitFor(() => expect(delegList().hidden).toBe(true));
  expect(delegChipButton().getAttribute("aria-expanded")).toBe("false");
});

it("closes the reasoning panel when the delegation list opens", async () => {
  await boot();
  answer({ kind: "ready", chat_id: "yui-3f9a2c1d" }, [running("d-1")]);
  answerReasoning({ text: "hmm", live: true });
  await vi.waitFor(() => expect(thinkPanel().hidden).toBe(false));

  delegChipButton().click();

  await vi.waitFor(() => expect(thinkPanel().hidden).toBe(true));
  expect(delegList().hidden).toBe(false);
});
