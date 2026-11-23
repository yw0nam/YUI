// @vitest-environment jsdom
/**
 * chat-type.test.tsx — the chat type row tells the three types apart: the popup carries the
 * long names, the closed trigger and the summary hint show the short name, and the description
 * line follows the selection.
 */
import { readFileSync } from "node:fs";
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentSettings } from "../../../../settings/backend/agent-settings";
import {
  createChatKeySettings,
  createSttKeySettings,
  createTtsKeySettings,
} from "../../../../settings/backend/api-key-settings";
import { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import { createProactiveSettings } from "../../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../../settings/cues/schedule-settings";
import { type Locale, setLocale, t } from "../../../i18n";
import { CARD_GUIDE_URL } from "../../constants";
import {
  inMemoryAgentStorage,
  inMemoryApiKeyStorage,
  optionNames,
  pickOption,
} from "../../test-helpers";
import { createConnectionPage } from "../connection-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORDER = ["chat_completions", "responses", "push"] as const;
const LONG = {
  en: {
    chat_completions: "Chat Completions · YUI sends the history",
    responses: "Responses · the server keeps the history",
    push: "Push · persistent connection",
  },
  ko: {
    chat_completions: "Chat Completions · 기록을 YUI가 보냄",
    responses: "Responses · 기록을 서버가 보관",
    push: "Push · 연결 유지",
  },
} as const;
const SHORT = { chat_completions: "Chat Completions", responses: "Responses", push: "Push" };

describe("chat type row", () => {
  let endpointsSettings: ReturnType<typeof createEndpointsSettings>;

  beforeEach(() => {
    globalThis.localStorage?.clear();
    endpointsSettings = createEndpointsSettings();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const dispose = (tab: { dispose(): void }) => act(() => tab.dispose());

  function build(locale: Locale) {
    setLocale(locale);
    const chatKeySettings = createChatKeySettings();
    const host = document.body.appendChild(document.createElement("div"));
    host.innerHTML = '<h1 class="yui-tabpanel__title">Connection</h1>';
    const tab = createConnectionPage({
      host,
      scope: null,
      initial: "detail",
      quick: {
        endpointsSettings,
        chatKeySettings,
        proactiveSettings: createProactiveSettings({ locale }),
        scheduleSettings: createScheduleSettings({ locale }),
        getFetch: async () => undefined,
        onConnected: () => {},
        showHelp: false,
      },
      detail: {
        endpointsSettings,
        chatKeySettings,
        ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
        sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
        agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
        isOpen: () => true,
        log: { debug() {}, info() {}, warn() {}, error() {} },
      },
    });
    tab.refresh();
    return tab;
  }

  const q = (el: HTMLElement, sel: string) => el.querySelector<HTMLElement>(sel)!;

  for (const locale of ["en", "ko"] as const) {
    it(`${locale}: the open list carries the long names in the agreed order`, async () => {
      const tab = build(locale);
      expect(await optionNames(q(tab.el, ".yui-chat-type"))).toEqual(
        ORDER.map((a) => LONG[locale][a]),
      );
      dispose(tab);
    });
  }

  it("the closed trigger, the summary hint and the description follow the selection", async () => {
    const tab = build("en");
    const select = q(tab.el, ".yui-chat-type");
    const desc = q(tab.el, ".yui-chat-type__desc");
    const expected = { chat_completions: "Ollama", responses: "OpenAI", push: "speak first" };
    for (const api of ORDER) {
      if (select.textContent !== SHORT[api]) await pickOption(select, LONG.en[api]);
      expect(select.textContent).toBe(SHORT[api]);
      expect(q(tab.el, ".yui-chat-summary-hint").textContent).toBe(SHORT[api]);
      expect(desc.textContent).toContain(expected[api]);
      expect(desc.getAttribute("aria-live")).toBe("polite");
    }
    dispose(tab);
  });

  it("the select keeps its name while its trigger shows the short one", () => {
    const tab = build("en");
    expect(q(tab.el, ".yui-chat-type").getAttribute("aria-label")).toBe(t("svc.chat_aria"));
    dispose(tab);
  });

  for (const locale of ["en", "ko", "ja"] as const) {
    it(`${locale}: no description names an agent or carries a link`, async () => {
      const tab = build(locale);
      const select = q(tab.el, ".yui-chat-type");
      for (const api of ORDER) {
        if (api !== "responses") await pickOption(select, t(`svc.chat_option_${api}`));
        const desc = q(tab.el, ".yui-chat-type__desc");
        expect(desc.querySelectorAll("a")).toHaveLength(0);
        expect(desc.textContent).not.toContain("{agent}");
        expect(desc.textContent).not.toContain("Hermes");
      }
      dispose(tab);
    });
  }

  it("the fade class leaves when its animation ends, so the next change replays it", async () => {
    const tab = build("en");
    const desc = q(tab.el, ".yui-chat-type__desc");
    await pickOption(q(tab.el, ".yui-chat-type"), LONG.en.chat_completions);
    expect(desc.classList.contains("is-swapping")).toBe(true);
    fireEvent.animationEnd(desc);
    expect(desc.classList.contains("is-swapping")).toBe(false);
    dispose(tab);
  });

  it("the settings window may open exactly the panel's link URLs through the opener", () => {
    const cap = JSON.parse(readFileSync("src-tauri/capabilities/settings.json", "utf8"));
    const grant = cap.permissions.find(
      (p: { identifier?: string }) => p.identifier === "opener:allow-open-url",
    );
    expect(grant.allow).toEqual([
      { url: CARD_GUIDE_URL },
      { url: "https://aistudio.google.com/apikey" },
      { url: "https://fish.audio/app/api-keys/" },
      { url: "https://hub.vroid.com/en/users/36144806" },
    ]);
  });
});
