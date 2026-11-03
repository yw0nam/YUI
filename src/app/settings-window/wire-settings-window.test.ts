// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProactiveSettings } from "../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../settings/cues/schedule-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { createPetWindows } from "../../settings/preset/pet-windows";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { setLocale } from "../../ui/i18n";
import { createDisposers } from "../disposers";
import { wireSettingsWindow } from "./wire-settings-window";

const { createQuickControls, wireWindowSettings } = vi.hoisted(() => ({
  createQuickControls:
    vi.fn<typeof import("../../ui/quick-controls/quick-controls").createQuickControls>(),
  wireWindowSettings: vi.fn<typeof import("../settings/wire-window-settings").wireWindowSettings>(),
}));
vi.mock("../../ui/quick-controls/quick-controls", () => ({ createQuickControls }));
vi.mock("../settings/wire-window-settings", () => ({ wireWindowSettings }));

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const lifecycle = { current: createDisposers() };

async function open(chatUrl: () => string): Promise<void> {
  const presetRegistry = createPresetRegistry();
  createQuickControls.mockImplementation(
    () =>
      ({
        open: vi.fn(),
        dispose: vi.fn(),
        selectedTab: () => "conn",
      }) as never,
  );
  wireWindowSettings.mockResolvedValue({
    settingsStores: {
      unifiedChatSwitch: createFlagSettings(false),
      proactiveSettings: createProactiveSettings({ locale: "en" }),
      scheduleSettings: createScheduleSettings({ locale: "en" }),
    },
    conversationStores: {},
    presetRegistry,
    petWindows: createPetWindows(),
    config: {},
    speaker: {},
    sessionReset: {},
    getEndpoints: () => ({ chat_base_url: chatUrl() }),
  } as never);
  lifecycle.current = createDisposers();
  await wireSettingsWindow({
    app: document.createElement("div"),
    lifecycle: lifecycle.current,
    presetRegistry,
  });
}

describe("wireSettingsWindow", () => {
  afterEach(() => {
    lifecycle.current.dispose();
    setLocale("en");
  });

  it("keeps the quick start through a locale rebuild after the key connected", async () => {
    let chatUrl = "";
    setLocale("en");
    await open(() => chatUrl);

    chatUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
    setLocale("ko");
    await settle();

    expect(createQuickControls.mock.calls.map(([deps]) => deps.openOnQuickStart)).toEqual([
      true,
      true,
    ]);
  });

  it("offers no quick start while chat is configured at window open", async () => {
    await open(() => "http://localhost:8643/v1");

    expect(createQuickControls.mock.calls[0]![0].openOnQuickStart).toBe(false);
  });
});
