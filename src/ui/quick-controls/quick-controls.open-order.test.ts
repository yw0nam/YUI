// @vitest-environment jsdom
/**
 * quick-controls.open-order.test.ts — the order of the effects the panel runs when it opens. Every
 * section the open handler calls is replaced by a recorder, so the case reads the call order only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./test-helpers";

const { order, rec } = vi.hoisted(() => {
  const order: string[] = [];
  const rec = (name: string, method: string) => () => {
    order.push(`${name}.${method}`);
  };
  return { order, rec };
});

vi.mock("./sections/screenshot/screenshot-section", () => ({
  createScreenshotSection: () => ({
    reflect: rec("screenshot", "reflect"),
    loadMonitorsIfEnabled: rec("screenshot", "loadMonitorsIfEnabled"),
    dispose: () => {},
  }),
}));
vi.mock("./switches/switch-rows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./switches/switch-rows")>()),
  bindSwitchRows: () => ({ reflect: rec("switchRows", "reflect"), dispose: () => {} }),
}));
vi.mock("./sections/reactions/reactions-section", () => ({
  createReactionsSection: () => ({ reflect: rec("reactions", "reflect"), dispose: () => {} }),
}));
vi.mock("./sections/screen/screen-section", () => ({
  createScreenSection: () => ({ reflect: rec("screen", "reflect"), dispose: () => {} }),
}));
vi.mock("./sections/voice-input/voice-input-section", () => ({
  createVoiceInputSection: () => ({ reflect: rec("voiceInput", "reflect"), dispose: () => {} }),
}));
vi.mock("./sections/agent/agent-section", () => ({
  createAgentSection: () => ({
    reflect: rec("agent", "reflect"),
    reflectLanguage: rec("agent", "reflectLanguage"),
    dispose: () => {},
  }),
}));
vi.mock("./sections/filler/filler-section", () => ({
  createFillerSection: () => ({ reflect: rec("filler", "reflect"), dispose: () => {} }),
}));
vi.mock("./connection/connection-tab", () => ({
  createConnectionTab: () => ({
    el: document.createElement("div"),
    refresh: rec("connectionTab", "refresh"),
    commit: () => {},
    dispose: () => {},
  }),
}));
vi.mock("./sections/session/session-section", () => ({
  createSessionSection: () => ({ reflect: rec("session", "reflect"), dispose: () => {} }),
}));
vi.mock("./history/history-tab", () => ({
  createHistoryTab: () => ({
    el: document.createElement("div"),
    refresh: rec("historyTab", "refresh"),
    dispose: () => {},
  }),
}));
vi.mock("./character/character-tab", () => ({
  createCharacterTab: () => ({
    el: document.createElement("div"),
    refresh: rec("characterTab", "refresh"),
    close: () => {},
    dispose: () => {},
  }),
}));
vi.mock("./sections/speaker/speaker-list", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sections/speaker/speaker-list")>()),
  createSpeakerList: () => ({
    render: rec("speakerList", "render"),
    stopAudition: () => {},
    dispose: () => {},
  }),
}));

describe("createQuickControls — open order", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    order.length = 0;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("redraws every section, refetches the voice list, then loads the monitors", () => {
    const qc = createQuickControls({
      ...defaultQcArgs(mount),
      transcript: createChatHistoryStore(),
      refreshVoiceList: rec("shell", "refreshVoiceList"),
    });

    qc.open();

    expect(order).toEqual([
      "screenshot.reflect",
      "switchRows.reflect",
      "reactions.reflect",
      "screen.reflect",
      "voiceInput.reflect",
      "agent.reflect",
      "filler.reflect",
      "agent.reflectLanguage",
      "connectionTab.refresh",
      "session.reflect",
      "historyTab.refresh",
      "characterTab.refresh",
      "speakerList.render",
      "shell.refreshVoiceList",
      "screenshot.loadMonitorsIfEnabled",
    ]);
    qc.dispose();
  });
});
