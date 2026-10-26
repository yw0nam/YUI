// @vitest-environment jsdom
/**
 * unified-main.test.ts — the unified chat window boots over the stored presets, follows the pet
 * windows' change signals, routes a message out over the bridge and tears down on unload.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../styles.css", () => ({}));
vi.mock("../ui/unified/unified-window.css", () => ({}));
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
  await vi.waitFor(() => expect(document.querySelector(".yui-uc__line")).not.toBeNull());
}

const says = () =>
  [...document.querySelectorAll(".yui-uc__say")].map((el) => el.textContent as string);

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

it("lists the transcripts of every open preset in time order", async () => {
  await boot();

  expect(says()).toEqual(["Hello from default.", "Hello from Natsume."]);
}, 15_000);

it("draws a reply that a pet window announces through the settings-changed signal", async () => {
  await boot();
  localStorage.setItem(
    "yui.natsume.chat_transcript",
    JSON.stringify([
      { role: "assistant", text: "Hello from Natsume.", ts: 2_000 },
      { role: "assistant", text: "One more.", ts: 3_000 },
    ]),
  );

  petBridge.emitSettingsChanged();

  await vi.waitFor(() => expect(says()).toContain("One more."));
});

it("routes a typed message to the last speaker over the bridge", async () => {
  const routed: UserTurnRouted[] = [];
  petBridge.onUserTurnRouted((e) => routed.push(e));
  await boot();
  const field = document.querySelector<HTMLTextAreaElement>(".yui-input__field")!;

  field.value = "hi";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );

  await vi.waitFor(() =>
    expect(routed).toEqual([{ sendId: expect.any(String), to: "natsume", text: "hi" }]),
  );
});

it("stops following the signals after unload", async () => {
  await boot();
  window.dispatchEvent(new Event("beforeunload"));
  localStorage.setItem(
    "yui.natsume.chat_transcript",
    JSON.stringify([{ role: "assistant", text: "After unload.", ts: 4_000 }]),
  );

  petBridge.emitSettingsChanged();
  await Promise.resolve();

  expect(says()).not.toContain("After unload.");
});
