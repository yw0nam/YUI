/**
 * The first synth failure of a pet-window run offers another voice under the bubble, once.
 *
 * The notice is driven through the listener set its `onSynthFailure` dep receives, so the
 * assertions cover what reaches the surfaces and the settings opener, skip the unified window,
 * and stop after dispose.
 */

import { describe, expect, it, vi } from "vitest";
import { wireSynthFailureNotice } from "./wire-synth-failure-notice";

function setup() {
  const listeners = new Set<() => void>();
  const surfaces = { showSpeechActions: vi.fn(), hideSpeech: vi.fn() };
  const openSettings = vi.fn();
  let unified = false;
  const notice = wireSynthFailureNotice({
    onSynthFailure: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
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
    fire: () => {
      for (const cb of [...listeners]) cb();
    },
    setUnified: (shown: boolean) => {
      unified = shown;
    },
  };
}

describe("wireSynthFailureNotice", () => {
  it("the first failure shows one action carrying the synth-failed label", () => {
    const s = setup();
    s.fire();

    expect(s.surfaces.showSpeechActions).toHaveBeenCalledOnce();
    const actions = s.surfaces.showSpeechActions.mock.calls[0][0];
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe("voice.synth_failed_action");
  });

  it("the action's click hides the speech and opens the voice page", () => {
    const s = setup();
    s.fire();
    const action = s.surfaces.showSpeechActions.mock.calls[0][0][0];
    action.onClick();

    expect(s.surfaces.hideSpeech).toHaveBeenCalledOnce();
    expect(s.openSettings).toHaveBeenCalledWith("voice");
    expect(s.surfaces.hideSpeech.mock.invocationCallOrder[0]).toBeLessThan(
      s.openSettings.mock.invocationCallOrder[0],
    );
  });

  it("a second failure in the same run shows nothing", () => {
    const s = setup();
    s.fire();
    s.fire();

    expect(s.surfaces.showSpeechActions).toHaveBeenCalledOnce();
  });

  it("a failure while the unified window is shown shows nothing and keeps the notice for the next failure", () => {
    const s = setup();
    s.setUnified(true);
    s.fire();
    expect(s.surfaces.showSpeechActions).not.toHaveBeenCalled();

    s.setUnified(false);
    s.fire();
    expect(s.surfaces.showSpeechActions).toHaveBeenCalledOnce();
  });

  it("after dispose a failure shows nothing", () => {
    const s = setup();
    s.notice.dispose();
    s.fire();

    expect(s.surfaces.showSpeechActions).not.toHaveBeenCalled();
  });
});
