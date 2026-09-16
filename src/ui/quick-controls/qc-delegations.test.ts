// @vitest-environment jsdom
/**
 * qc-delegations.test.ts — the session section's delegated-work list (window variant only):
 * hidden when the mirrored list is empty, rows running-first with the same times as the chip's
 * popover, the one lost-connection line that stands in for the rows while the socket is not
 * ready, a once-a-minute refresh while items are held, and teardown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatHistoryStore } from "../../io/chat/chat-history-store";
import type { DelegationItem, PushSocketState } from "../../io/chat/push-socket";
import { createSessionDiagnosticsStore } from "../../io/chat/session-diagnostics";
import { createSessionStore } from "../../io/chat/session-store";
import { createEndpointsSettings } from "../../io/settings/endpoints-settings";
import { setLocale, t } from "../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "./test-helpers";

const NOW = 1_789_365_900_000;

function running(id: string, startedAgoMs: number): DelegationItem {
  return { id, title: `work ${id}`, started_at: NOW - startedAgoMs, state: "running" };
}

function done(id: string, endedAgoMs: number): DelegationItem {
  return {
    id,
    title: `work ${id}`,
    started_at: NOW - endedAgoMs - 600_000,
    state: "done",
    ended_at: NOW - endedAgoMs,
  };
}

/** The list as the settings window sees it — a mirrored store the bridge refills. */
function fakeDelegations(initial: DelegationItem[] = []) {
  let items = initial;
  const subs = new Set<(items: DelegationItem[]) => void>();
  return {
    get: () => items,
    subscribe(cb: (items: DelegationItem[]) => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    emit(next: DelegationItem[]): void {
      items = next;
      for (const cb of subs) cb(next);
    },
    listenerCount: () => subs.size,
    refresh: vi.fn(),
  };
}

/** The socket as the settings window sees it — a mirror the pet window feeds. */
function fakePushSocket(initial: PushSocketState = { kind: "ready", chat_id: "yui-3f9a2c1d" }) {
  let state = initial;
  const subs = new Set<(s: PushSocketState) => void>();
  return {
    getState: () => state,
    onState(cb: (s: PushSocketState) => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    sendReset: vi.fn(() => true),
    reconnectNow: vi.fn(),
    emit(next: PushSocketState): void {
      state = next;
      for (const cb of subs) cb(next);
    },
  };
}

describe("createQuickControls — session section delegated list", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    vi.useFakeTimers({
      now: NOW,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });

    setLocale("ko");
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    mount.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    setLocale("en");
  });

  function buildQc(delegations: ReturnType<typeof fakeDelegations>) {
    // The occupancy readout and the delegated list share the session section — window variant,
    // and the three stores the section needs before it renders.
    return createQuickControls({
      ...defaultQcArgs(mount),
      variant: "window",
      transcript: createChatHistoryStore(),
      sessionStore: createSessionStore(),
      sessionDiagnostics: createSessionDiagnosticsStore(),
      delegations,
    });
  }

  function delegEl(qc: { el: HTMLElement }): HTMLElement {
    return qc.el.querySelector<HTMLElement>(".yui-session__deleg")!;
  }

  function rowTimes(qc: { el: HTMLElement }): string[] {
    return [
      ...qc.el.querySelectorAll<HTMLElement>(".yui-session__deleg-rows .yui-deleg__item-time"),
    ].map((el) => el.textContent);
  }

  it("stays hidden while the mirrored list is empty", () => {
    const qc = buildQc(fakeDelegations());
    qc.open();

    expect(delegEl(qc).hidden).toBe(true);

    qc.dispose();
  });

  it("shows the list under the context stat line once items arrive", () => {
    const delegations = fakeDelegations();
    const qc = buildQc(delegations);
    qc.open();
    expect(delegEl(qc).hidden).toBe(true);

    delegations.emit([done("d-2", 12 * 60_000), running("d-1", 4 * 60_000)]);

    expect(delegEl(qc).hidden).toBe(false);
    expect(qc.el.querySelector<HTMLElement>(".yui-session__deleg-title")!.textContent).toBe(
      t("deleg.list_title"),
    );
    // Same rows as the chip's popover: running first, elapsed for running, done-ago for done.
    expect(rowTimes(qc)).toEqual(["4분", "끝남 · 12분 전"]);

    qc.dispose();
  });

  it("hides again when the list empties", () => {
    const delegations = fakeDelegations([running("d-1", 60_000)]);
    const qc = buildQc(delegations);
    qc.open();
    expect(delegEl(qc).hidden).toBe(false);

    delegations.emit([]);

    expect(delegEl(qc).hidden).toBe(true);

    qc.dispose();
  });

  it("refreshes the times once a minute while items are held", () => {
    const delegations = fakeDelegations([running("d-1", 4 * 60_000)]);
    const qc = buildQc(delegations);
    qc.open();
    expect(rowTimes(qc)).toEqual(["4분"]);

    vi.advanceTimersByTime(60_000);

    expect(rowTimes(qc)).toEqual(["5분"]);

    qc.dispose();
  });

  it("asks the mirror to refresh on the minute tick, so it re-filters past its TTL", () => {
    const delegations = fakeDelegations([running("d-1", 4 * 60_000)]);
    const qc = buildQc(delegations);
    qc.open();

    vi.advanceTimersByTime(60_000);

    expect(delegations.refresh).toHaveBeenCalledOnce();

    qc.dispose();
  });

  // The rows describe work the backend is doing; with the transport down they describe nothing.
  describe("lost connection", () => {
    function buildPushQc(
      delegations: ReturnType<typeof fakeDelegations>,
      pushSocket: ReturnType<typeof fakePushSocket>,
    ) {
      const endpointsSettings = createEndpointsSettings();
      endpointsSettings.set({ chat_api: "push" });
      return createQuickControls({
        ...defaultQcArgs(mount),
        variant: "window",
        transcript: createChatHistoryStore(),
        sessionStore: createSessionStore(),
        sessionDiagnostics: createSessionDiagnosticsStore(),
        endpointsSettings,
        delegations,
        pushSocket,
      });
    }

    function lostEl(qc: { el: HTMLElement }): HTMLElement {
      return qc.el.querySelector<HTMLElement>(".yui-session__deleg-lost")!;
    }

    function rowsEl(qc: { el: HTMLElement }): HTMLElement {
      return qc.el.querySelector<HTMLElement>(".yui-session__deleg-rows")!;
    }

    it("swaps the rows for one lost line while the socket is not ready", () => {
      const delegations = fakeDelegations([running("d-1", 60_000)]);
      const qc = buildPushQc(
        delegations,
        fakePushSocket({ kind: "reconnecting", delay_ms: 4_000 }),
      );
      qc.open();

      expect(delegEl(qc).hidden).toBe(false);
      expect(lostEl(qc).hidden).toBe(false);
      expect(lostEl(qc).textContent).toContain(t("deleg.chip_lost"));
      expect(rowsEl(qc).hidden).toBe(true);

      qc.dispose();
    });

    it("leaves the chat section's status line the only one of its kind", () => {
      const qc = buildPushQc(fakeDelegations(), fakePushSocket({ kind: "failed", code: 4401 }));
      qc.open();

      const lines = [...qc.el.querySelectorAll<HTMLElement>(".yui-chat-status")];
      expect(lines).toHaveLength(1);
      expect(lines[0]!.closest('.yui-svc[data-svc="chat"]')).not.toBeNull();

      qc.dispose();
    });

    it("shows the lost line with nothing on the list at all", () => {
      const qc = buildPushQc(fakeDelegations(), fakePushSocket({ kind: "failed", code: 4401 }));
      qc.open();

      expect(delegEl(qc).hidden).toBe(false);
      expect(lostEl(qc).hidden).toBe(false);

      qc.dispose();
    });

    it("hides the lost line while the socket is ready", () => {
      const delegations = fakeDelegations([running("d-1", 60_000)]);
      const qc = buildPushQc(delegations, fakePushSocket());
      qc.open();

      expect(lostEl(qc).hidden).toBe(true);
      expect(rowsEl(qc).hidden).toBe(false);
      expect(rowTimes(qc)).toEqual(["1분"]);

      qc.dispose();
    });

    it("brings the rows back on the next frame after the socket returns", () => {
      const delegations = fakeDelegations();
      const pushSocket = fakePushSocket({ kind: "connecting" });
      const qc = buildPushQc(delegations, pushSocket);
      qc.open();
      expect(lostEl(qc).hidden).toBe(false);

      pushSocket.emit({ kind: "ready", chat_id: "yui-3f9a2c1d" });
      delegations.emit([running("d-1", 4 * 60_000)]);

      expect(lostEl(qc).hidden).toBe(true);
      expect(rowsEl(qc).hidden).toBe(false);
      expect(rowTimes(qc)).toEqual(["4분"]);

      qc.dispose();
    });
  });

  it("stops its subscription and minute timer on dispose", () => {
    const delegations = fakeDelegations([running("d-1", 60_000)]);
    const qc = buildQc(delegations);
    qc.open();
    qc.dispose();

    expect(delegations.listenerCount()).toBe(0);
    expect(() => vi.advanceTimersByTime(120_000)).not.toThrow();
  });
});
