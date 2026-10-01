/**
 * General tab of the phone settings view: the voice input mode, the stage background (Default or
 * a picked image) and the speech bubble's keep-until-dismissed switch.
 */

import type { StageBackgroundStore } from "../../../../io/assets/stage/stage-background";
import type { Logger } from "../../../../logger";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import type { VoiceMode, VoiceModeStore } from "../../../../settings/voice/voice-mode";
import { createBubbleSection } from "./bubble/bubble-section";
import { createStageSection } from "./stage/stage-section";
import { createVoiceSection } from "./voice/voice-section";

export interface GeneralTab {
  el: HTMLElement;
  /** Repaint every row from its store — the open hook. */
  refresh(): void;
  dispose(): void;
}

export function createGeneralTab(deps: {
  stageBackground: Pick<StageBackgroundStore, "get" | "setMode" | "subscribe">;
  /** Pick, copy and apply an image; rejects when the file is not a usable image. */
  importStageImage: () => Promise<void>;
  bubblePersistSettings: FlagSettingsStore;
  voiceMode: Pick<VoiceModeStore, "get" | "subscribe">;
  /** Applies a voice mode choice; the mode store changes once the choice holds. */
  selectVoiceMode: (mode: VoiceMode) => void;
  log: Logger;
}): GeneralTab {
  const {
    stageBackground,
    importStageImage,
    bubblePersistSettings,
    voiceMode,
    selectVoiceMode,
    log,
  } = deps;

  const el = document.createElement("div");
  el.className = "yui-tab-stack";

  const voice = createVoiceSection({ voiceMode, selectVoiceMode, log });

  const stage = createStageSection({ stageBackground, importStageImage, log });

  const bubble = createBubbleSection({ bubblePersistSettings, log });

  el.append(voice.el, stage.el, bubble.el);

  return {
    el,
    refresh(): void {
      voice.refresh();
      stage.refresh();
      bubble.refresh();
    },
    dispose(): void {
      bubble.dispose();
      stage.dispose();
      voice.dispose();
      el.remove();
    },
  };
}
