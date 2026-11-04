/**
 * A reply the voice server could not speak offers Reconnect under its bubble once it ends, once per
 * outage.
 *
 * The notice is driven through the listener sets its reach and utterance deps receive, so the
 * assertions cover what reaches the surfaces and what Reconnect does with the check's answer.
 */

import { describe, expect, it, vi } from "vitest";
import type { UtteranceIdentity } from "../../../contract";
import type { SpeechAction } from "../../../io/bridge/message/message-remote";
import { wireTtsUnreachableNotice } from "./wire-tts-unreachable-notice";

const REPLY = { turn_id: "7", event_name: "user.text_submitted" };
const GREETING = { turn_id: "1", event_name: "greeting" };
const OFFER = "voice.unreachable_action";

function setup() {
  const reachListeners = new Set<(reach: "ok" | "unreachable") => void>();
  const startListeners = new Set<() => void>();
  const endListeners = new Set<(identity: UtteranceIdentity) => void>();
  const surfaces = { showSpeechActions: vi.fn<(actions: readonly SpeechAction[]) => void>() };
  let settle: (reached: boolean) => void = () => {};
  const reconnect = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        settle = resolve;
      }),
  );
  let unified = false;
  const notice = wireTtsUnreachableNotice({
    onTtsReach: (cb) => {
      reachListeners.add(cb);
      return () => reachListeners.delete(cb);
    },
    onUtteranceStart: (cb) => {
      startListeners.add(cb);
      return () => startListeners.delete(cb);
    },
    onUtteranceEnd: (cb) => {
      endListeners.add(cb);
      return () => endListeners.delete(cb);
    },
    reconnect,
    surfaces,
    isUnifiedShown: () => unified,
    t: (key) => key,
  });
  return {
    notice,
    surfaces,
    reconnect,
    reach: (reach: "ok" | "unreachable") => {
      for (const cb of [...reachListeners]) cb(reach);
    },
    start: () => {
      for (const cb of [...startListeners]) cb();
    },
    end: (identity: UtteranceIdentity) => {
      for (const cb of [...endListeners]) cb(identity);
    },
    settle: async (reached: boolean) => {
      settle(reached);
      await Promise.resolve();
    },
    setUnified: (shown: boolean) => {
      unified = shown;
    },
    labels: () =>
      surfaces.showSpeechActions.mock.calls.map((call) =>
        call[0].map((a) => (a.busy ? `${a.label} (busy)` : a.label)),
      ),
    click: () => surfaces.showSpeechActions.mock.lastCall![0][0]!.onClick(),
  };
}

describe("wireTtsUnreachableNotice", () => {
  it("offers Reconnect once per outage, and again after an ok reach and a new outage", () => {
    const s = setup();
    s.reach("unreachable");
    s.end(REPLY);
    s.reach("unreachable");
    s.end(REPLY);
    expect(s.labels()).toEqual([[OFFER]]);

    s.reach("ok");
    s.reach("unreachable");
    s.end(REPLY);
    expect(s.labels()).toEqual([[OFFER], [OFFER]]);
  });

  it.each([
    ["the greeting", GREETING, false],
    ["a reply while the unified window is shown", REPLY, true],
  ])("shows nothing at the end of %s", (_l, identity, unified) => {
    const s = setup();
    s.setUnified(unified);
    s.reach("unreachable");
    s.end(identity);

    expect(s.surfaces.showSpeechActions).not.toHaveBeenCalled();
  });

  it("shows nothing at a reply's end when an ok reach followed a prewarm's unreachable one", () => {
    const s = setup();
    s.reach("unreachable");
    s.reach("ok");
    s.end(REPLY);

    expect(s.surfaces.showSpeechActions).not.toHaveBeenCalled();
  });

  it.each([
    ["a reached server clears the actions", true, []],
    ["an unreached server offers Reconnect again", false, [OFFER]],
  ])("Reconnect shows Connecting… while it checks; %s", async (_l, reached, after) => {
    const s = setup();
    s.reach("unreachable");
    s.end(REPLY);

    s.click();
    expect(s.reconnect).toHaveBeenCalledOnce();
    await s.settle(reached);

    expect(s.labels()).toEqual([[OFFER], ["svc.chat_status_connecting (busy)"], after]);
  });

  it("leaves the actions to new speech that starts while Reconnect checks", async () => {
    const s = setup();
    s.reach("unreachable");
    s.end(REPLY);
    s.click();

    s.start();
    await s.settle(true);

    expect(s.labels()).toEqual([[OFFER], ["svc.chat_status_connecting (busy)"]]);
  });
});
