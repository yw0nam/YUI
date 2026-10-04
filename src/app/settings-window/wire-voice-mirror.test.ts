import { expect, it, vi } from "vitest";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { wireVoiceMirror } from "./wire-voice-mirror";

type VoiceStateSnapshot = Parameters<Parameters<SettingsBridge["onVoiceState"]>[0]>[0];

function setup() {
  const voiceInputStatus = createVoiceInputStatus();
  let remote: (s: VoiceStateSnapshot) => void = () => {};
  const unsubscribeRemote = vi.fn();
  const bridge = {
    emitVoiceSet: vi.fn(),
    onVoiceState: vi.fn((cb: (s: VoiceStateSnapshot) => void) => {
      remote = cb;
      return unsubscribeRemote;
    }),
  };
  const dispose = wireVoiceMirror({ voiceInputStatus, bridge });
  return {
    voiceInputStatus,
    bridge,
    dispose,
    unsubscribeRemote,
    remote: (s: VoiceStateSnapshot) => remote(s),
  };
}

it("applies a remote voice state locally without echoing it back", () => {
  const { voiceInputStatus, bridge, remote } = setup();

  remote({ state: "listening" });

  expect(voiceInputStatus.get().state).toBe("listening");
  expect(bridge.emitVoiceSet).not.toHaveBeenCalled();
});

it("emits a local change to the bridge", () => {
  const { voiceInputStatus, bridge } = setup();

  voiceInputStatus.set("listening");
  voiceInputStatus.set("idle");

  expect(bridge.emitVoiceSet.mock.calls).toEqual([[true], [false]]);
});

it("stops emitting after the disposer runs", () => {
  const { voiceInputStatus, bridge, dispose, unsubscribeRemote } = setup();

  dispose();
  voiceInputStatus.set("listening");

  expect(bridge.emitVoiceSet).not.toHaveBeenCalled();
  expect(unsubscribeRemote).toHaveBeenCalledOnce();
});
