// @vitest-environment jsdom
/**
 * connection-page.test.ts — the Connection page's two views: the switch over them, the scope
 * line, and what entering the page or switching the view enters.
 */
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerCheck } from "../../../io/chat/models/server-check";
import { createAgentSettings } from "../../../settings/backend/agent-settings";
import {
  createChatKeySettings,
  createSttKeySettings,
  createTtsKeySettings,
} from "../../../settings/backend/api-key-settings";
import { createEndpointsSettings } from "../../../settings/backend/endpoints-settings";
import { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import { setLocale } from "../../i18n";
import { GEMINI_PRESET } from "../constants";
import { inMemoryAgentStorage, inMemoryApiKeyStorage } from "../test-helpers";
import { createConnectionPage } from "./connection-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const models = () => new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 });

function setup(initial: "quick" | "detail" = "quick") {
  const panel = document.body.appendChild(document.createElement("div"));
  panel.className = "yui-tabpanel";
  panel.innerHTML = `
    <p class="yui-tabpanel__scope"></p>
    <h1 class="yui-tabpanel__title">Connection</h1>
  `;
  const endpointsSettings = createEndpointsSettings();
  const chatKeySettings = createChatKeySettings();
  // Detailed settings is entered when its STT line checks; Quick start when its stored-key check reads.
  const detailEntered = vi.fn(async (): Promise<ServerCheck | null> => ({ kind: "ok" }));
  const quickEntered = vi.fn(async () => models());
  const page = createConnectionPage({
    host: panel,
    scope: panel.querySelector<HTMLElement>(".yui-tabpanel__scope"),
    initial,
    quick: {
      endpointsSettings,
      chatKeySettings,
      proactiveSettings: createProactiveSettings({ locale: "en" }),
      scheduleSettings: createScheduleSettings({ locale: "en" }),
      getFetch: async () => quickEntered,
      onConnected: () => {},
      showHelp: false,
    },
    detail: {
      endpointsSettings,
      chatKeySettings,
      ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
      sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      checkSttServer: detailEntered,
      getEndpoints: () => ({
        chat_base_url: "",
        stt_base_url: "https://stt.test/v1",
        tts_base_url: "",
      }),
      isOpen: () => true,
      log: { debug() {}, info() {}, warn() {}, error() {} },
    },
  });
  const connect = () => {
    endpointsSettings.set({ chat_base_url: GEMINI_PRESET.url });
    chatKeySettings.setApiKey("AIza-good");
  };
  const wrapper = (view: string) =>
    panel.querySelector<HTMLElement>(`.yui-conn-view[data-view="${view}"]`)!;
  const cell = (view: "quick" | "detail") =>
    panel.querySelectorAll<HTMLButtonElement>(".yui-conn-views .yui-seg__btn")[
      view === "quick" ? 0 : 1
    ]!;
  const scope = () => panel.querySelector<HTMLElement>(".yui-tabpanel__scope")!;
  return { page, connect, detailEntered, quickEntered, wrapper, cell, scope };
}

describe("createConnectionPage — the views", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    setLocale("en");
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens on Quick start: the quick view shows, the detail view and the scope line hide", () => {
    const s = setup("quick");

    expect(s.wrapper("quick").hidden).toBe(false);
    expect(s.wrapper("detail").hidden).toBe(true);
    expect(s.scope().hidden).toBe(true);
    expect(s.cell("quick").getAttribute("aria-checked")).toBe("true");
    expect(s.cell("quick").tabIndex).toBe(0);
    expect(s.cell("detail").getAttribute("aria-checked")).toBe("false");
    expect(s.cell("detail").tabIndex).toBe(-1);

    act(() => s.page.entered());
    expect(s.detailEntered).not.toHaveBeenCalled();
    act(() => s.page.dispose());
  });

  it("clicking Detailed settings shows it, shows the scope line and enters the detail view", () => {
    const s = setup("quick");

    fireEvent.click(s.cell("detail"));

    expect(s.wrapper("detail").hidden).toBe(false);
    expect(s.wrapper("quick").hidden).toBe(true);
    expect(s.scope().hidden).toBe(false);
    expect(s.detailEntered).toHaveBeenCalledTimes(1);
    act(() => s.page.dispose());
  });

  it("entering the Connection page while the detail view shows enters it", () => {
    const s = setup("quick");
    fireEvent.click(s.cell("detail"));
    s.detailEntered.mockClear();

    act(() => s.page.entered());

    expect(s.detailEntered).toHaveBeenCalledTimes(1);
    act(() => s.page.dispose());
  });

  it("entering the Connection page while Quick start shows enters it", async () => {
    const s = setup("quick");
    s.connect();

    act(() => s.page.entered());
    await settle();

    expect(s.quickEntered).toHaveBeenCalledOnce();
    act(() => s.page.dispose());
  });

  it("clicking Quick start goes back and re-reads its state", async () => {
    const s = setup("quick");
    fireEvent.click(s.cell("detail"));
    s.connect();

    fireEvent.click(s.cell("quick"));
    await settle();

    expect(s.wrapper("quick").hidden).toBe(false);
    expect(s.wrapper("detail").hidden).toBe(true);
    expect(s.scope().hidden).toBe(true);
    expect(s.wrapper("quick").querySelector<HTMLElement>(".yui-start__connected")!.hidden).toBe(
      false,
    );
    expect(s.quickEntered).toHaveBeenCalledTimes(1);

    fireEvent.click(s.cell("quick"));
    await settle();
    expect(s.quickEntered).toHaveBeenCalledTimes(1);
    act(() => s.page.dispose());
  });

  it("ArrowRight moves the selection to Detailed settings", async () => {
    const s = setup("quick");
    act(() => s.cell("quick").focus());

    // Base UI moves focus in a microtask, so the arrow settles inside the awaited act.
    await act(async () => {
      fireEvent.keyDown(s.cell("quick"), { key: "ArrowRight" });
    });

    expect(s.cell("detail").getAttribute("aria-checked")).toBe("true");
    expect(s.wrapper("detail").hidden).toBe(false);
    expect(s.detailEntered).toHaveBeenCalledTimes(1);
    act(() => s.page.dispose());
  });
});
