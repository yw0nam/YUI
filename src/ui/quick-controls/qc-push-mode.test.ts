// @vitest-environment jsdom
/**
 * qc-push-mode.test.ts — what the settings panel's chat section shows and does in push mode:
 * the Hermes provider preset, the hidden model row, the connection status line, and the reset frame.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createChatHistoryStore } from "../../io/chat/chat-history-store";
import type { PushSocketState } from "../../io/chat/push-socket";
import { createSessionDiagnosticsStore } from "../../io/chat/session-diagnostics";
import { createSessionStore } from "../../io/chat/session-store";
import { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import { setLocale, t } from "../i18n";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./test-helpers";

describe("createQuickControls — push mode", () => {
  let mount: HTMLElement;
  let endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  let state: PushSocketState;
  let listeners: ((s: PushSocketState) => void)[];
  let sendReset: Mock<() => boolean>;
  let reconnectNow: Mock<() => void>;

  function pushSocket() {
    return {
      getState: () => state,
      onState: (cb: (s: PushSocketState) => void) => {
        listeners.push(cb);
        return () => {
          listeners = listeners.filter((l) => l !== cb);
        };
      },
      sendReset,
      reconnectNow,
    };
  }

  function emit(next: PushSocketState): void {
    state = next;
    for (const cb of listeners) cb(next);
  }

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
    endpointsSettings = createEndpointsSettings();
    state = { kind: "disconnected" };
    listeners = [];
    sendReset = vi.fn<() => boolean>(() => true);
    reconnectNow = vi.fn<() => void>();
  });

  afterEach(() => {
    mount.remove();
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({ ...defaultQcArgs(mount), endpointsSettings, ...extra });
  }

  /** The three stores the "Start fresh" footer needs before it renders. */
  function sessionArgs() {
    return {
      transcript: createChatHistoryStore(),
      sessionStore: createSessionStore(),
      sessionDiagnostics: createSessionDiagnosticsStore(),
    };
  }

  function statusEl(qc: { el: HTMLElement }): HTMLElement {
    return qc.el.querySelector<HTMLElement>(".yui-chat-status")!;
  }

  function actionBtn(qc: { el: HTMLElement }): HTMLButtonElement {
    return qc.el.querySelector<HTMLButtonElement>(".yui-chat-status__action")!;
  }

  function modelRow(qc: { el: HTMLElement }): HTMLElement {
    return qc.el.querySelector<HTMLElement>('.yui-input-row[data-ep-field="chat_model"]')!;
  }

  // ── Provider preset ────────────────────────────────────────────────────────

  it("offers Hermes Agent in the chat provider dropdown", () => {
    const qc = buildQc();
    qc.open();

    const preset = qc.el.querySelector<HTMLSelectElement>(".yui-chat-preset")!;
    expect(Array.from(preset.options).map((o) => o.value)).toContain("hermes");

    qc.dispose();
  });

  it("selecting Hermes Agent switches to push and leaves the URL for the user", () => {
    const qc = buildQc();
    qc.open();

    const preset = qc.el.querySelector<HTMLSelectElement>(".yui-chat-preset")!;
    preset.value = "hermes";
    preset.dispatchEvent(new Event("change"));

    expect(endpointsSettings.get().chat_api).toBe("push");
    expect(endpointsSettings.get().chat_base_url).toBe("");

    qc.dispose();
  });

  it("shows Hermes Agent as the selected provider while the mode is push", () => {
    endpointsSettings.set({ chat_api: "push" });
    const qc = buildQc();
    qc.open();

    expect(qc.el.querySelector<HTMLSelectElement>(".yui-chat-preset")!.value).toBe("hermes");

    qc.dispose();
  });

  it("selecting push in the type dropdown persists the override", () => {
    const qc = buildQc({ getDefaultChatApi: () => "responses" });
    qc.open();

    const type = qc.el.querySelector<HTMLSelectElement>(".yui-chat-type")!;
    type.value = "push";
    type.dispatchEvent(new Event("change"));

    expect(endpointsSettings.get().chat_api).toBe("push");

    qc.dispose();
  });

  // ── Model row ──────────────────────────────────────────────────────────────

  it("hides the chat model row in push mode", () => {
    endpointsSettings.set({ chat_api: "push" });
    const qc = buildQc();
    qc.open();

    expect(modelRow(qc).hidden).toBe(true);

    qc.dispose();
  });

  it("keeps the chat model row in the other modes", () => {
    const qc = buildQc({ getDefaultChatApi: () => "responses" });
    qc.open();

    expect(modelRow(qc).hidden).toBe(false);

    qc.dispose();
  });

  it("brings the model row back when the mode leaves push", () => {
    endpointsSettings.set({ chat_api: "push" });
    const qc = buildQc();
    qc.open();
    expect(modelRow(qc).hidden).toBe(true);

    const type = qc.el.querySelector<HTMLSelectElement>(".yui-chat-type")!;
    type.value = "responses";
    type.dispatchEvent(new Event("change"));

    expect(modelRow(qc).hidden).toBe(false);

    qc.dispose();
  });

  // ── Connection status line ─────────────────────────────────────────────────

  it("hides the status line outside push mode", () => {
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    expect(statusEl(qc).hidden).toBe(true);

    qc.dispose();
  });

  it("hides the status line in push mode when no socket is wired", () => {
    endpointsSettings.set({ chat_api: "push" });
    const qc = buildQc();
    qc.open();

    expect(statusEl(qc).hidden).toBe(true);

    qc.dispose();
  });

  it("names the conversation the socket is connected under", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "ready", chat_id: "yui-3f9a2c1d" };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    expect(statusEl(qc).hidden).toBe(false);
    expect(statusEl(qc).textContent).toContain(
      t("svc.chat_status_connected", { id: "yui-3f9a2c1d" }),
    );
    expect(statusEl(qc).classList.contains("is-ready")).toBe(true);

    qc.dispose();
  });

  it("shows how long until the next attempt while reconnecting", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "reconnecting", delay_ms: 4_000 };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    expect(statusEl(qc).textContent).toContain(t("svc.chat_status_reconnecting", { seconds: 4 }));
    expect(statusEl(qc).classList.contains("is-waiting")).toBe(true);

    qc.dispose();
  });

  it("names the refused key as the reason, instead of the bare close code", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "failed", code: 4401 };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    expect(statusEl(qc).textContent).toContain(t("svc.chat_status_refused"));
    expect(statusEl(qc).textContent).not.toContain("4401");
    expect(statusEl(qc).classList.contains("is-failed")).toBe(true);

    qc.dispose();
  });

  // ── Reconnect button ───────────────────────────────────────────────────────

  it("offers Reconnect in the refused state", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "failed", code: 4401 };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    expect(actionBtn(qc).hidden).toBe(false);
    expect(actionBtn(qc).textContent).toBe(t("svc.chat_status_reconnect"));

    qc.dispose();
  });

  it("opens the socket when Reconnect is pressed", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "failed", code: 4401 };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    actionBtn(qc).click();

    expect(reconnectNow).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("offers Connect now while a reconnect waits", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "reconnecting", delay_ms: 8_000 };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    expect(actionBtn(qc).hidden).toBe(false);
    expect(actionBtn(qc).textContent).toBe(t("svc.chat_status_connect_now"));

    qc.dispose();
  });

  it("skips the wait when Connect now is pressed", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "reconnecting", delay_ms: 8_000 };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    actionBtn(qc).click();

    expect(reconnectNow).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("offers no button while the socket is connecting", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "connecting" };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    expect(actionBtn(qc).hidden).toBe(true);

    qc.dispose();
  });

  it("offers no button once the socket is ready", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "ready", chat_id: "yui-3f9a2c1d" };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();

    expect(actionBtn(qc).hidden).toBe(true);

    qc.dispose();
  });

  it("drops the button again when the socket comes back", () => {
    endpointsSettings.set({ chat_api: "push" });
    state = { kind: "reconnecting", delay_ms: 1_000 };
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();
    expect(actionBtn(qc).hidden).toBe(false);

    emit({ kind: "ready", chat_id: "yui-0a1b2c3d" });

    expect(actionBtn(qc).hidden).toBe(true);

    qc.dispose();
  });

  it("follows the socket as its state changes while the panel is open", () => {
    endpointsSettings.set({ chat_api: "push" });
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();
    expect(statusEl(qc).textContent).toContain(t("svc.chat_status_offline"));

    emit({ kind: "connecting" });
    expect(statusEl(qc).textContent).toContain(t("svc.chat_status_connecting"));

    emit({ kind: "ready", chat_id: "yui-0a1b2c3d" });
    expect(statusEl(qc).textContent).toContain(
      t("svc.chat_status_connected", { id: "yui-0a1b2c3d" }),
    );

    qc.dispose();
  });

  it("drops its socket subscription on dispose", () => {
    endpointsSettings.set({ chat_api: "push" });
    const qc = buildQc({ pushSocket: pushSocket() });
    qc.open();
    qc.dispose();

    expect(listeners).toEqual([]);
  });

  // ── Start fresh ────────────────────────────────────────────────────────────

  it("sends a reset frame when the conversation is reset in push mode", () => {
    endpointsSettings.set({ chat_api: "push" });
    const qc = buildQc({ variant: "popover", pushSocket: pushSocket(), ...sessionArgs() });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__reset")!.click();
    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__confirm")!.click();

    expect(sendReset).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("stops the running turn before the reset frame goes out", () => {
    endpointsSettings.set({ chat_api: "push" });
    const calls: string[] = [];
    sendReset.mockImplementation(() => {
      calls.push("sendReset");
      return true;
    });
    const stopTurn = vi.fn(() => {
      calls.push("stopTurn");
    });
    const qc = buildQc({
      variant: "popover",
      pushSocket: pushSocket(),
      stopTurn,
      ...sessionArgs(),
    });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__reset")!.click();
    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__confirm")!.click();

    expect(calls).toEqual(["stopTurn", "sendReset"]);

    qc.dispose();
  });

  it("sends no reset frame outside push mode", () => {
    const qc = buildQc({ variant: "popover", pushSocket: pushSocket(), ...sessionArgs() });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__reset")!.click();
    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__confirm")!.click();

    expect(sendReset).not.toHaveBeenCalled();

    qc.dispose();
  });
});
