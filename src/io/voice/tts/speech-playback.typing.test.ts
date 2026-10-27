// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createSurfaces } from "../../../ui/surfaces/surfaces";
import { noTool } from "../../../ui/surfaces/test-helpers";
import { createSpeechPlayback } from "./speech-playback";

afterEach(() => vi.useRealTimers());

it("types a voiced line at 40 ms per character before synthesis completes", () => {
  vi.useFakeTimers();
  const mount = document.createElement("div");
  document.body.append(mount);
  const surfaces = createSurfaces({ mount, tool: noTool });
  const synth = vi.fn(() => new Promise<ArrayBuffer>(() => {}));
  const playback = createSpeechPlayback({
    surfaces,
    renderer: {
      setMouthOpen() {},
      stopMouth() {},
      easeEmotionToNeutral() {},
      applyDirective() {},
      playMotion() {},
    },
    pipeline: { synth },
    isStrolling: () => false,
  });
  try {
    playback.onSpeechDelta("Hello world. ", { turn_id: "1", event_name: "user.text_submitted" });
    expect(synth).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 40);
    expect(mount.querySelector(".yui-bubble__text")?.textContent).toBe("Hello");
  } finally {
    playback.dispose();
    surfaces.dispose();
    mount.remove();
  }
});
