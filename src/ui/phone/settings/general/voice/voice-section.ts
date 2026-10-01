/**
 * General tab, Voice input section: the Tap to toggle / Keep listening segment. The checked button
 * follows the mode store; a choice goes out through `selectVoiceMode`, which saves it once it holds,
 * so the segment never moves ahead of the store.
 */

import type { Logger } from "../../../../../logger";
import type { VoiceMode, VoiceModeStore } from "../../../../../settings/voice/voice-mode";
import { t } from "../../../../i18n";
import { secHeadHtml } from "../../../../quick-controls/markup";
import { bindRadioSegment } from "../segment/radio-segment";
import "./voice-section.css";

const MODES: readonly VoiceMode[] = ["tap", "always"];

const sectionHtml = (): string => `
  ${secHeadHtml(t("phone.voice.section"))}
  <p class="yui-voice-note">${t("phone.voice.note")}</p>
  <div class="yui-group">
    <div class="yui-row">
      <div class="yui-seg yui-voice-seg" role="radiogroup" aria-label="${t("phone.voice.mode_aria")}">${MODES.map(
        (m) =>
          `<button class="yui-seg__btn" type="button" role="radio" data-mode="${m}" aria-checked="false" tabindex="-1">${t(`phone.voice.mode_${m}`)}</button>`,
      ).join("")}</div>
    </div>
  </div>`;

export function createVoiceSection(deps: {
  voiceMode: Pick<VoiceModeStore, "get" | "subscribe">;
  selectVoiceMode: (mode: VoiceMode) => void;
  log: Logger;
}): { el: HTMLElement; refresh(): void; dispose(): void } {
  const { voiceMode, selectVoiceMode, log } = deps;

  const el = document.createElement("div");
  el.className = "yui-sec";
  el.innerHTML = sectionHtml();
  const segment = bindRadioSegment({
    seg: el.querySelector<HTMLElement>(".yui-voice-seg")!,
    onCommit: (index) => {
      log.info("voice_mode_select", { mode: MODES[index] });
      selectVoiceMode(MODES[index]);
    },
  });

  const refresh = (): void => segment.reflect(MODES.indexOf(voiceMode.get().mode));
  const unsubscribe = voiceMode.subscribe(refresh);
  refresh();

  return {
    el,
    refresh,
    dispose(): void {
      unsubscribe();
      segment.dispose();
      el.remove();
    },
  };
}
