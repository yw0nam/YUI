/**
 * The speech stream as a message bridge — what a pet window's surfaces would send the message
 * window goes to the unified chat window instead, stamped with the preset. What comes back is the
 * late-join ask, which arrives as the message window's `ready`, and a click on an error's fix that
 * names this preset.
 */

import type { SettingsBridge } from "../settings-bridge";
import type { MessageBridge } from "./message-bridge";

export function createStreamBridge(deps: {
  presetId: string;
  settingsBridge: Pick<
    SettingsBridge,
    "emitSpeechStream" | "onSpeechStreamAsk" | "onSpeechStreamControl"
  >;
}): MessageBridge {
  return {
    emitSurface: (op) => deps.settingsBridge.emitSpeechStream({ preset: deps.presetId, op }),
    onSurface: () => () => {},
    emitControl() {},
    onControl(cb) {
      const offAsk = deps.settingsBridge.onSpeechStreamAsk(() => cb({ op: "ready" }));
      const offControl = deps.settingsBridge.onSpeechStreamControl(({ preset, op }) => {
        if (preset === deps.presetId) cb(op);
      });
      return () => {
        offAsk();
        offControl();
      };
    },
    dispose() {},
  };
}
