/**
 * General tab of the phone settings view: the stage background (Default or a picked image) and
 * the speech bubble's keep-until-dismissed switch.
 */

import type { StageBackgroundStore } from "../../../../io/assets/stage/stage-background";
import type { Logger } from "../../../../logger";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import { t } from "../../../i18n";
import { secHeadHtml } from "../../../quick-controls/markup";
import { createBubblePersistRow } from "../../../quick-controls/switch-row";
import { bindSwitchRows, switchRowHtml } from "../../../quick-controls/switches/switch-rows";
import { createStageSection } from "./stage-section";

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
  log: Logger;
}): GeneralTab {
  const { stageBackground, importStageImage, bubblePersistSettings, log } = deps;

  const el = document.createElement("div");
  el.className = "yui-tab-stack";

  const stage = createStageSection({ stageBackground, importStageImage, log });

  const bubbleRow = createBubblePersistRow(bubblePersistSettings);
  const bubbleSec = document.createElement("div");
  bubbleSec.className = "yui-sec";
  bubbleSec.innerHTML = `${secHeadHtml(t("phone.general.bubble_section"))}<div class="yui-group">${switchRowHtml(bubbleRow)}</div>`;
  const switches = bindSwitchRows(bubbleSec, [bubbleRow], log);
  const unsubscribeBubble = bubblePersistSettings.subscribe(() => switches.reflect());

  el.append(stage.el, bubbleSec);

  return {
    el,
    refresh(): void {
      stage.refresh();
      switches.reflect();
    },
    dispose(): void {
      unsubscribeBubble();
      switches.dispose();
      stage.dispose();
      el.remove();
    },
  };
}
