// @vitest-environment jsdom
/**
 * unified-main.test.ts — the unified chat window boots over the stored presets, follows the pet
 * windows' change signals, routes a message out over the bridge and tears down on unload.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../styles.css", () => ({}));
vi.mock("../ui/unified/unified-window.css", () => ({}));
vi.mock("../ui/message/message-window.css", () => ({}));
vi.mock("../ui/surfaces/surfaces.css", () => ({}));
vi.mock("../ui/tokens.css", () => ({}));

import {
  createSettingsBridge,
  type SettingsBridge,
  type UserTurnRouted,
} from "../io/bridge/settings-bridge";
import { setLocale } from "../ui/i18n";

let petBridge: SettingsBridge;

function seedStorage(): void {
  localStorage.setItem(
    "yui.presets",
    JSON.stringify({
      active: "default",
      list: [
        { id: "default", name: "Default" },
        { id: "natsume", name: "Natsume" },
      ],
    }),
  );
  localStorage.setItem("yui.windows", JSON.stringify({ open: ["natsume"] }));
  localStorage.setItem(
    "yui.chat_transcript",
    JSON.stringify([{ role: "assistant", text: "Hello from default.", ts: 1_000 }]),
  );
  localStorage.setItem(
    "yui.natsume.chat_transcript",
    JSON.stringify([{ role: "assistant", text: "Hello from Natsume.", ts: 2_000 }]),
  );
}

async function boot(): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  await import("./unified-main");
  await vi.waitFor(() => expect(document.querySelector(".yui-uc__chip")).not.toBeNull());
}

const chipNames = () =>
  [...document.querySelectorAll(".yui-uc__chip-name")].map((el) => el.textContent as string);

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
  seedStorage();
  petBridge = createSettingsBridge(undefined, { windowKind: "pet" });
});

afterEach(() => {
  petBridge.dispose();
  window.dispatchEvent(new Event("beforeunload"));
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

it("shows a chip for every open preset", async () => {
  await boot();

  expect(chipNames()).toEqual(["Default", "Natsume"]);
}, 15_000);

it("renames a chip when a pet window announces a settings change", async () => {
  await boot();
  localStorage.setItem(
    "yui.presets",
    JSON.stringify({
      active: "default",
      list: [
        { id: "default", name: "Default" },
        { id: "natsume", name: "Natsu" },
      ],
    }),
  );

  petBridge.emitSettingsChanged();

  await vi.waitFor(() => expect(chipNames()).toContain("Natsu"));
});

it("routes a typed message to the last speaker over the bridge", async () => {
  const routed: UserTurnRouted[] = [];
  petBridge.onUserTurnRouted((e) => routed.push(e));
  await boot();
  const field = document.querySelector<HTMLTextAreaElement>(".yui-uc__dock .yui-input__field")!;

  field.value = "hi";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );

  await vi.waitFor(() =>
    expect(routed).toEqual([{ sendId: expect.any(String), to: "natsume", text: "hi" }]),
  );
});

it("routes main's spoken message to the last speaker over the bridge, marked as spoken", async () => {
  const routed: UserTurnRouted[] = [];
  petBridge.onUserTurnRouted((e) => routed.push(e));
  await boot();

  petBridge.emitVoiceSegment({ text: "hi" });

  await vi.waitFor(() =>
    expect(routed).toEqual([
      { sendId: expect.any(String), to: "natsume", text: "hi", via: "voice" },
    ]),
  );
});

it("asks the pet windows to restate themselves, and draws the line a pet window streams", async () => {
  const asks = vi.fn();
  petBridge.onSpeechStreamAsk(asks);
  await boot();
  await vi.waitFor(() => expect(asks).toHaveBeenCalledOnce());

  petBridge.emitSpeechStream({ preset: "natsume", op: { op: "begin" } });
  petBridge.emitSpeechStream({ preset: "natsume", op: { op: "push", delta: "Running" } });

  await vi.waitFor(() =>
    expect(document.querySelector(".yui-bubble__text")?.textContent).toBe("Running"),
  );
});

it("sends the stop to every pet window", async () => {
  const stops = vi.fn();
  petBridge.onStopTurns(stops);
  await boot();
  petBridge.emitSpeechStream({ preset: "natsume", op: { op: "busy", busy: true } });
  await vi.waitFor(() =>
    expect(
      document.querySelector(".yui-uc__dock .yui-input")?.classList.contains("is-running"),
    ).toBe(true),
  );

  document.querySelector<HTMLButtonElement>(".yui-uc__dock .yui-input__send")!.click();

  await vi.waitFor(() => expect(stops).toHaveBeenCalledOnce());
});

it("answers a speech onset like the stop button while a send runs, and not while idle", async () => {
  const stops = vi.fn();
  petBridge.onStopTurns(stops);
  await boot();
  petBridge.emitSpeechOnset();
  await Promise.resolve();
  expect(stops).not.toHaveBeenCalled();

  const field = document.querySelector<HTMLTextAreaElement>(".yui-uc__dock .yui-input__field")!;
  field.value = "hi";
  field.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(
      document.querySelector(".yui-uc__dock .yui-input")!.classList.contains("is-running"),
    ).toBe(true),
  );

  petBridge.emitSpeechOnset();

  await vi.waitFor(() => expect(stops).toHaveBeenCalledOnce());
  await vi.waitFor(() =>
    expect(
      document.querySelector(".yui-uc__dock .yui-input")!.classList.contains("is-running"),
    ).toBe(false),
  );
});

it("ends its send on another window's stop without sending a stop of its own", async () => {
  const stops = vi.fn();
  petBridge.onStopTurns(stops);
  await boot();
  const field = document.querySelector<HTMLTextAreaElement>(".yui-uc__dock .yui-input__field")!;
  const form = document.querySelector(".yui-uc__dock .yui-input")!;
  field.value = "hi";
  field.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  expect(form.classList.contains("is-running")).toBe(true);

  petBridge.emitStopTurns();

  await vi.waitFor(() => expect(form.classList.contains("is-running")).toBe(false));
  expect(stops).not.toHaveBeenCalled();
});

it("stops following the signals after unload", async () => {
  await boot();
  window.dispatchEvent(new Event("beforeunload"));

  petBridge.emitSpeechStream({ preset: "natsume", op: { op: "begin" } });
  petBridge.emitSpeechStream({ preset: "natsume", op: { op: "push", delta: "After unload." } });
  await Promise.resolve();

  expect(document.querySelector(".yui-bubble__text")?.textContent ?? "").toBe("");
});
