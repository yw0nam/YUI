/** The Reaction thresholds rows: waiting count and wait segments dimmed while the Thread reactions switch is off. */

import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import {
  REACTION_COUNTS,
  REACTION_WAITS,
  type ReactionCount,
  type ReactionWait,
  type ThreadReactionThresholdsSettingsStore,
} from "../../../../settings/threads/thread-reaction-thresholds-settings";
import { t } from "../../../i18n";
import { createStoreSegment } from "../../store-segment";

const countLabel = (n: ReactionCount): string =>
  n === 0 ? t("threadReactionThresholds.off") : t("threadReactionThresholds.count_value", { n });
const waitLabel = (n: ReactionWait): string =>
  n === 0 ? t("threadReactionThresholds.off") : t("threadReactionThresholds.wait_value", { n });

export function threadReactionThresholdsRowHtml(): string {
  const countCells = REACTION_COUNTS.map(
    (n) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-count="${n}" aria-checked="false" tabindex="-1">${countLabel(n)}</button>`,
  ).join("");
  const waitCells = REACTION_WAITS.map(
    (n) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-wait="${n}" aria-checked="false" tabindex="-1">${waitLabel(n)}</button>`,
  ).join("");
  return `
          <div class="yui-row yui-reaction-thresholds-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t("threadReactionThresholds.count_label")}</span>
              <span class="yui-row__sub">${t("threadReactionThresholds.count_sub")}</span>
            </div>
            <div class="yui-seg yui-reaction-thresholds-count-seg" role="radiogroup" aria-label="${t("threadReactionThresholds.count_label")}">${countCells}</div>
          </div>
          <div class="yui-row yui-reaction-thresholds-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t("threadReactionThresholds.wait_label")}</span>
              <span class="yui-row__sub">${t("threadReactionThresholds.wait_sub")}</span>
            </div>
            <div class="yui-seg yui-reaction-thresholds-wait-seg" role="radiogroup" aria-label="${t("threadReactionThresholds.wait_label")}">${waitCells}</div>
          </div>
          <span class="yui-row__sub yui-reaction-thresholds-reason" hidden>${t("threadReactionThresholds.disabled_reason")}</span>`;
}

/** Binds both Reaction thresholds segments to their store; the cells and the reason follow the Thread reactions switch. */
export function createThreadReactionThresholdsRow(deps: {
  root: HTMLElement;
  settings: ThreadReactionThresholdsSettingsStore;
  threadReactionsSettings: FlagSettingsStore;
  isOpen: () => boolean;
}) {
  const { root, settings, threadReactionsSettings, isOpen } = deps;
  const countSegment = root.querySelector<HTMLElement>(".yui-reaction-thresholds-count-seg")!;
  const waitSegment = root.querySelector<HTMLElement>(".yui-reaction-thresholds-wait-seg")!;
  const reason = root.querySelector<HTMLElement>(".yui-reaction-thresholds-reason")!;
  const countStore = createStoreSegment({
    segment: countSegment,
    values: REACTION_COUNTS,
    get: () => settings.get().count,
    set: settings.setCount,
    subscribe: settings.subscribe,
    isOpen,
  });
  const waitStore = createStoreSegment({
    segment: waitSegment,
    values: REACTION_WAITS,
    get: () => settings.get().wait_min,
    set: settings.setWait,
    subscribe: settings.subscribe,
    isOpen,
  });
  const reflectEnabled = (): void => {
    const enabled = threadReactionsSettings.get().enabled;
    for (const segment of [countSegment, waitSegment])
      for (const button of segment.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"))
        button.disabled = !enabled;
    reason.hidden = enabled;
  };
  const unsubscribe = threadReactionsSettings.subscribe(() => {
    if (isOpen()) reflectEnabled();
  });
  return {
    reflect(): void {
      countStore.reflect();
      waitStore.reflect();
      reflectEnabled();
    },
    dispose(): void {
      unsubscribe();
      countStore.dispose();
      waitStore.dispose();
    },
  };
}
