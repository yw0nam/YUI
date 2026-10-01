// @vitest-environment jsdom
/**
 * history-tab.test.ts — the extracted History tab: refresh renders the list and disarms a
 * pending start-fresh confirmation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatHistoryStore } from "../../../io/chat/chat-history-store";
import { createSessionDiagnosticsStore } from "../../../io/chat/session-diagnostics";
import { createSessionStore } from "../../../io/chat/session-store";
import { setLocale } from "../../i18n";
import { createHistoryTab } from "./history-tab";

describe("createHistoryTab", () => {
  beforeEach(() => {
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("refresh clears a pending confirmation and renders the session list", () => {
    const transcript = createChatHistoryStore();
    transcript.append({
      role: "user",
      text: "first question",
      ts: Date.parse("2026-08-12T07:40:00Z"),
    });
    transcript.append({
      role: "assistant",
      text: "first answer",
      ts: Date.parse("2026-08-12T07:41:00Z"),
    });
    const tab = createHistoryTab({
      transcript,
      sessionDiagnostics: createSessionDiagnosticsStore(),
      sessionStore: createSessionStore(),
      getChatApi: () => "push",
      isOpen: () => true,
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    document.body.append(tab.el);
    const confirmEl = tab.el.querySelector<HTMLElement>(".yui-hist__action .yui-confirm")!;
    const resetBtn = tab.el.querySelector<HTMLButtonElement>(".yui-session__reset")!;

    resetBtn.click();
    expect(confirmEl.hidden).toBe(false);

    tab.refresh();

    expect(confirmEl.hidden).toBe(true);
    expect(resetBtn.hidden).toBe(false);
    expect(tab.el.textContent).toContain("first question");
    tab.dispose();
  });
});
