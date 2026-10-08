// @vitest-environment jsdom
/**
 * chat-type.test.ts — the chat type row tells the three types apart: the open list carries the
 * long names, the closed control and the summary hint show the short name, and the description
 * line follows the selection.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createChatKeySettings,
  createSttKeySettings,
  createTtsKeySettings,
} from "../../../settings/backend/api-key-settings";
import { createEndpointsSettings } from "../../../settings/backend/endpoints-settings";
import { type Locale, setLocale, t } from "../../i18n";
import { inMemoryApiKeyStorage } from "../test-helpers";
import { createConnectionTab } from "./connection-tab";

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

  function build(locale: Locale) {
    setLocale(locale);
    const tab = createConnectionTab({
      endpointsSettings,
      chatKeySettings: createChatKeySettings(),
      sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
      ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
      rows: { chat: "full", tts: "full", broker: false },
      isOpen: () => true,
      log: { debug() {}, info() {}, warn() {}, error() {} },
    });
    document.body.append(tab.el);
    tab.refresh();
    return tab;
  }

  const q = (el: HTMLElement, sel: string) => el.querySelector<HTMLElement>(sel)!;

  for (const locale of ["en", "ko"] as const) {
    it(`${locale}: the open list carries the long names in the agreed order`, () => {
      const tab = build(locale);
      const options = [...q(tab.el, ".yui-chat-type").querySelectorAll("option")];
      expect(options.map((o) => o.value)).toEqual(ORDER);
      expect(options.map((o) => o.textContent)).toEqual(ORDER.map((a) => LONG[locale][a]));
      tab.dispose();
    });

    it(`${locale}: the closed overlay, the summary hint and the description follow the selection`, () => {
      const tab = build(locale);
      for (const api of ORDER) {
        const select = q(tab.el, ".yui-chat-type") as HTMLSelectElement;
        select.value = api;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(q(tab.el, ".yui-chat-type__shown").textContent).toBe(SHORT[api]);
        expect(q(tab.el, ".yui-chat-summary-hint").textContent).toBe(SHORT[api]);
        const desc = q(tab.el, ".yui-chat-type__desc");
        expect(desc.textContent).toBe(t(`svc.chat_desc_${api}`));
        expect(desc.textContent).not.toBe("");
        expect(desc.getAttribute("aria-live")).toBe("polite");
      }
      tab.dispose();
    });
  }

  it("the overlay is hidden from assistive tech and the select keeps its name", () => {
    const tab = build("en");
    expect(q(tab.el, ".yui-chat-type__shown").getAttribute("aria-hidden")).toBe("true");
    expect(q(tab.el, ".yui-chat-type").getAttribute("aria-label")).toBe(t("svc.chat_aria"));
    tab.dispose();
  });

  it("the Korean descriptions name the example servers", () => {
    setLocale("ko");
    expect(t("svc.chat_desc_chat_completions")).toContain("Ollama, LM Studio, vLLM");
    expect(t("svc.chat_desc_responses")).toContain("OpenAI");
  });
});
