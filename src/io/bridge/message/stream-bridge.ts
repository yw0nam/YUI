/**
 * The speech stream as a message bridge — what a pet window's surfaces would send the message
 * window goes to the unified chat window instead, stamped with the preset. Nothing comes back but
 * the late-join ask, which arrives as the message window's `ready`.
 */

import type { SettingsBridge } from "../settings-bridge";
import type { MessageBridge } from "./message-bridge";

export function createStreamBridge(deps: {
  presetId: string;
  settingsBridge: Pick<SettingsBridge, "emitSpeechStream" | "onSpeechStreamAsk">;
}): MessageBridge {
  return {
    emitSurface: (op) => deps.settingsBridge.emitSpeechStream({ preset: deps.presetId, op }),
    onSurface: () => () => {},
    emitControl() {},
    onControl: (cb) => deps.settingsBridge.onSpeechStreamAsk(() => cb({ op: "ready" })),
    dispose() {},
  };
}
