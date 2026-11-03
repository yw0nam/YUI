/**
 * A reply's synth failure offers another voice under that reply's bubble once it ends, once a run.
 *
 * The notice is driven through the listener sets its `onSynthFailure` and `onUtteranceEnd` deps
 * receive, so the assertions cover what reaches the surfaces and the settings opener, skip the
 * greeting and the unified window without using the notice up, and stop after dispose.
 */

import { describe, expect, it, vi } from "vitest";
import type { UtteranceIdentity } from "../../../contract";
import { wireSynthFailureNotice } from "./wire-synth-failure-notice";

const REPLY = { turn_id: "7", event_name: "user.text_submitted" };
const GREETING = { turn_id: "1", event_name: "greeting" };

function setup() {
  const failureListeners = new Set<() => void>();
  const endListeners = new Set<(identity: UtteranceIdentity) => void>();
  const surfaces = { showSpeechActions: vi.fn(), hideSpeech: vi.fn() };
  const openSettings = vi.fn();
  let unified = false;
  const notice = wireSynthFailureNotice({
    onSynthFailure: (cb) => {
      failureListeners.add(cb);
      return () => failureListeners.delete(cb);
    },
    onUtteranceEnd: (cb) => {
      endListeners.add(cb);
      return () => endListeners.delete(cb);
    },
    surfaces,
    openSettings,
    isUnifiedShown: () => unified,
    t: (key) => key,
  });
  return {
    notice,
    surfaces,
    openSettings,
    fail: () => {
      for (const cb of [...failureListeners]) cb();
    },
    end: (identity: UtteranceIdentity) => {
      for (const cb of [...endListeners]) cb(identity);
    },
    setUnified: (shown: boolean) => {
      unified = shown;
    },
  };
}

describe("wireSynthFailureNotice", () => {
  it("a reply's failure shows one action carrying the synth-failed label when the reply ends", () => {
    const s = setup();
    s.fail();
    expect(s.surfaces.showSpeechActions).not.toHaveBeenCalled();

    s.end(REPLY);

    expect(s.surfaces.showSpeechActions).toHaveBeenCalledOnce();
    const actions = s.surfaces.showSpeechActions.mock.calls[0][0];
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe("voice.synth_failed_action");
  });

  it("the action's click hides the speech and opens the voice page", () => {
    const s = setup();
    s.fail();
    s.end(REPLY);
    const action = s.surfaces.showSpeechActions.mock.calls[0][0][0];
    action.onClick();

    expect(s.surfaces.hideSpeech).toHaveBeenCalledOnce();
    expect(s.openSettings).toHaveBeenCalledWith("voice");
    expect(s.surfaces.hideSpeech.mock.invocationCallOrder[0]).toBeLessThan(
      s.openSettings.mock.invocationCallOrder[0],
    );
  });

  it("a reply that synthesized fine shows nothing and keeps the notice for a later failure", () => {
    const s = setup();
    s.end(REPLY);
    expect(s.surfaces.showSpeechActions).not.toHaveBeenCalled();

    s.fail();
    s.end(REPLY);
    expect(s.surfaces.showSpeechActions).toHaveBeenCalledOnce();
  });

  it("a second reply failure in the same run shows nothing", () => {
    const s = setup();
    s.fail();
    s.end(REPLY);
    s.fail();
    s.end(REPLY);

    expect(s.surfaces.showSpeechActions).toHaveBeenCalledOnce();
  });

  it("a greeting's failure shows nothing, stays with the greeting, and keeps the notice", () => {
    const s = setup();
    s.fail();
    s.end(GREETING);
    s.end(REPLY);
    expect(s.surfaces.showSpeechActions).not.toHaveBeenCalled();

    s.fail();
    s.end(REPLY);
    expect(s.surfaces.showSpeechActions).toHaveBeenCalledOnce();
  });

  it("a failure while the unified window is shown shows nothing and keeps the notice for the next failure", () => {
    const s = setup();
    s.setUnified(true);
    s.fail();
    s.end(REPLY);
    expect(s.surfaces.showSpeechActions).not.toHaveBeenCalled();

    s.setUnified(false);
    s.fail();
    s.end(REPLY);
    expect(s.surfaces.showSpeechActions).toHaveBeenCalledOnce();
  });

  it("after dispose a failure shows nothing", () => {
    const s = setup();
    s.notice.dispose();
    s.fail();
    s.end(REPLY);

    expect(s.surfaces.showSpeechActions).not.toHaveBeenCalled();
  });
});
