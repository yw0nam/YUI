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

vi.mock("./perms/perms-page", () => ({
  createPermsPage: () => ({
    el: document.createElement("div"),
    loadMonitorsIfEnabled: rec("perms", "loadMonitorsIfEnabled"),
    dispose: () => {},
  }),
}));
vi.mock("./connection/connection-tab", () => ({
  createConnectionTab: () => ({
    el: document.createElement("div"),
    refresh: rec("connectionTab", "refresh"),
    commit: () => {},
    dispose: () => {},
  }),
}));
vi.mock("./delegations/delegation-feed", () => ({
  createDelegationFeed: () => ({ sync: rec("delegationFeed", "sync"), dispose: () => {} }),
}));
vi.mock("./history/history-page", () => ({
  createHistoryPage: () => ({
    el: document.createElement("div"),
    refresh: rec("historyPage", "refresh"),
    dispose: () => {},
  }),
}));
vi.mock("./body/body-page", () => ({
  createBodyPage: () => ({
    el: document.createElement("div"),
    refresh: rec("bodyPage", "refresh"),
    dispose: () => {},
  }),
}));
vi.mock("./motion/motion-page", () => ({
  createMotionPage: () => ({
    el: document.createElement("div"),
    refresh: rec("motionPage", "refresh"),
    close: () => {},
    dispose: () => {},
  }),
}));
vi.mock("./voice/voice-page", () => ({
  createVoicePage: () => ({
    el: document.createElement("div"),
    refresh: rec("voicePage", "refresh"),
    close: () => {},
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

  it("redraws every remaining section, refetches the voice list, then loads the monitors", () => {
    const qc = createQuickControls({
      ...defaultQcArgs(mount),
      transcript: createChatHistoryStore(),
      refreshVoiceList: rec("shell", "refreshVoiceList"),
    });

    qc.open();

    expect(order).toEqual([
      "connectionTab.refresh",
      "delegationFeed.sync",
      "historyPage.refresh",
      "bodyPage.refresh",
      "motionPage.refresh",
      "voicePage.refresh",
      "shell.refreshVoiceList",
      "perms.loadMonitorsIfEnabled",
    ]);
    qc.dispose();
  });
});
