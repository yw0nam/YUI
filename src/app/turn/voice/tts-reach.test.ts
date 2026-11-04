import { describe, expect, it, vi } from "vitest";
import type { ServerCheck } from "../../../io/chat/models/server-check";
import type { VoiceListOutcome } from "../../../io/voice/voices/voice-list-refresh";
import { createTtsReach } from "./tts-reach";

/** A voice list refresh whose requests settle when the test says so. */
function heldRefresh() {
  const pending: ((outcome: VoiceListOutcome) => void)[] = [];
  const refreshVoiceList = vi.fn(
    () => new Promise<VoiceListOutcome>((resolve) => pending.push(resolve)),
  );
  return {
    refreshVoiceList,
    settle: (outcome: VoiceListOutcome) => {
      for (const resolve of pending.splice(0)) resolve(outcome);
    },
  };
}

describe("createTtsReach", () => {
  it.each([
    ["an unreachable", false, { kind: "unreachable" }],
    ["a timed-out", false, { kind: "timeout" }],
    ["an ok", true, { kind: "ok" }],
    ["an HTTP error", true, { kind: "http", status: 500 }],
    ["no (null)", true, null],
  ] as const)("reconnect reads %s check as reached: %s", async (_l, reached, result) => {
    const reach = createTtsReach({
      refreshVoiceList: vi.fn(),
      checkTtsServer: async () => result as ServerCheck | null,
    });
    const seen: string[] = [];
    reach.onReach((r) => seen.push(r));

    await expect(reach.reconnect()).resolves.toBe(reached);
    expect(seen).toEqual([reached ? "ok" : "unreachable"]);
  });

  it("reconnect waits for a voice list retry in flight instead of checking again", async () => {
    const held = heldRefresh();
    const checkTtsServer = vi.fn(async () => ({ kind: "ok" }) as const);
    const reach = createTtsReach({ refreshVoiceList: held.refreshVoiceList, checkTtsServer });
    void reach.ensureSpeaker(
      () => false,
      () => true,
    );

    const reconnected = reach.reconnect();
    held.settle({ kind: "timeout" });

    await expect(reconnected).resolves.toBe(false);
    expect(checkTtsServer).not.toHaveBeenCalled();
  });

  it("clear leaves a voice list retry in flight to its callers", async () => {
    const held = heldRefresh();
    const reach = createTtsReach({
      refreshVoiceList: held.refreshVoiceList,
      checkTtsServer: async () => null,
    });
    const first = reach.ensureSpeaker(
      () => false,
      () => true,
    );

    reach.clear();
    const second = reach.ensureSpeaker(
      () => false,
      () => true,
    );
    held.settle({ kind: "ok" });

    await Promise.all([first, second]);
    expect(held.refreshVoiceList).toHaveBeenCalledOnce();
  });
});
