// @vitest-environment jsdom
/**
 * quick-controls.open-order.test.ts — the order of the effects the panel runs when it opens. Every
 * section the open handler calls is replaced by a recorder, so the case reads the call order only.
 */

import { act } from "react";
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

// Each mock is typed against its real controller, so a change to the controller's shape fails here.
vi.mock("./perms/perms-page", () => ({
  createPermsPage: (): import("./perms/perms-page").PermsPage => ({
    view: () => null,
    loadMonitorsIfEnabled: rec("perms", "loadMonitorsIfEnabled"),
  }),
}));
vi.mock("./connection/connection-page", () => ({
  createConnectionPage: (): import("./connection/connection-page").ConnectionPage => ({
    view: () => null,
    quickShown: { get: () => false, subscribe: () => () => {} },
    refresh: rec("connectionPage", "refresh"),
    entered: rec("connectionPage", "entered"),
    windowFocused: () => {},
    focusKey: () => {},
    focusChatType: () => {},
    commit: () => {},
    close: () => {},
  }),
}));
vi.mock("./delegations/delegation-feed", () => ({
  createDelegationFeed: (): import("./delegations/delegation-feed").DelegationFeed => ({
    present: false,
    get: () => [],
    version: () => 0,
    subscribe: () => () => {},
    sync: rec("delegationFeed", "sync"),
    dispose: () => {},
  }),
}));
vi.mock("./history/history-page", () => ({
  createHistoryPage: (): import("./history/history-page").HistoryPage => ({
    view: () => null,
    refresh: rec("historyPage", "refresh"),
  }),
}));
vi.mock("./body/body-page", () => ({
  createBodyPage: (): import("./body/body-page").BodyPage => ({
    view: () => null,
    refresh: rec("bodyPage", "refresh"),
  }),
}));
vi.mock("./motion/motion-page", () => ({
  createMotionPage: (): import("./motion/motion-page").MotionPage => ({
    view: () => null,
    refresh: rec("motionPage", "refresh"),
    close: () => {},
  }),
}));
vi.mock("./voice/voice-page", () => ({
  createVoicePage: (): import("./voice/voice-page").VoicePage => ({
    view: () => null,
    refresh: rec("voicePage", "refresh"),
    close: () => {},
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

  let qc: ReturnType<typeof createQuickControls> | undefined;

  afterEach(() => {
    act(() => qc?.dispose());
    qc = undefined;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("redraws every remaining section, refetches the voice list, then loads the monitors", () => {
    qc = createQuickControls({
      ...defaultQcArgs(mount),
      transcript: createChatHistoryStore(),
      refreshVoiceList: rec("shell", "refreshVoiceList"),
    });

    qc.open();

    expect(order).toEqual([
      "connectionPage.refresh",
      "delegationFeed.sync",
      "historyPage.refresh",
      "bodyPage.refresh",
      "motionPage.refresh",
      "voicePage.refresh",
      "shell.refreshVoiceList",
      "perms.loadMonitorsIfEnabled",
    ]);
  });

  it("opening on the Connection page enters it after every redraw and before the voice list and the monitors", () => {
    qc = createQuickControls({
      ...defaultQcArgs(mount),
      transcript: createChatHistoryStore(),
      refreshVoiceList: rec("shell", "refreshVoiceList"),
      openOnQuickStart: true,
    });

    qc.open();

    expect(order).toEqual([
      "connectionPage.refresh",
      "delegationFeed.sync",
      "historyPage.refresh",
      "bodyPage.refresh",
      "motionPage.refresh",
      "voicePage.refresh",
      "connectionPage.entered",
      "shell.refreshVoiceList",
      "perms.loadMonitorsIfEnabled",
    ]);
  });
});
