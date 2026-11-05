// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    vi.unstubAllGlobals();
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

  it("the STT line's check sends the stored STT key", async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal("fetch", ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      // The bundled configs load for real, so the window's effective endpoints exist.
      let body = "";
      if (url.startsWith("/configs/")) {
        try {
          body = readFileSync(join(process.cwd(), url), "utf8");
        } catch {
          body = "";
        }
      }
      return Promise.resolve(new Response(body, { status: body ? 200 : 404 }));
    }) as typeof fetch);
    // The real window wiring, so the secret provider the check reads is the one under review.
    wireWindowSettings.mockImplementation(async (deps) => {
      const actual = await vi.importActual<typeof import("../settings/wire-window-settings")>(
        "../settings/wire-window-settings",
      );
      return actual.wireWindowSettings(deps);
    });

    const presetRegistry = createPresetRegistry();
    createQuickControls.mockImplementation(
      () =>
        ({
          open: vi.fn(),
          dispose: vi.fn(),
          selectedTab: () => "conn",
        }) as never,
    );
    lifecycle.current = createDisposers();
    await wireSettingsWindow({
      app: document.createElement("div"),
      lifecycle: lifecycle.current,
      presetRegistry,
    });

    const deps = createQuickControls.mock.calls.at(-1)![0];
    deps.endpointsSettings.set({ stt_base_url: "https://stt.test/v1" });
    deps.sttKeySettings.setApiKey("stt-key-1841");
    await deps.checkSttServer!();

    const models = requests.find((r) => r.url === "https://stt.test/v1/models");
    expect(models?.authorization).toBe("Bearer stt-key-1841");
  });
});
