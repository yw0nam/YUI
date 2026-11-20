/** The Reaction thresholds rows: the waiting count and wait segments in the Threads fold. */

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

const cells = <T extends number>(
  values: readonly T[],
  attr: string,
  label: (n: T) => string,
): string =>
  values
    .map(
      (n) =>
        `<button class="yui-seg__btn" type="button" role="radio" ${attr}="${n}" aria-checked="false" tabindex="-1">${label(n)}</button>`,
    )
    .join("");

export function threadReactionThresholdsRowHtml(): string {
  const countCells = cells(REACTION_COUNTS, "data-count", countLabel);
  const waitCells = cells(REACTION_WAITS, "data-wait", waitLabel);
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
          </div>`;
}

/**
 * Binds both Reaction thresholds segments to their store and writes them into the Threads fold's summary.
 * They stay editable while Thread reactions is off; the fold only dims.
 */
export function createThreadReactionThresholdsRow(deps: {
  root: HTMLElement;
  settings: ThreadReactionThresholdsSettingsStore;
  isOpen: () => boolean;
}) {
  const { root, settings, isOpen } = deps;
  const countSegment = root.querySelector<HTMLElement>(".yui-reaction-thresholds-count-seg")!;
  const waitSegment = root.querySelector<HTMLElement>(".yui-reaction-thresholds-wait-seg")!;
  const aside = countSegment.closest(".yui-fold")?.querySelector(".yui-fold__aside");
  // "3 waiting · 10 min"; a threshold set to Off drops out of the line.
  const reflectAside = (): void => {
    if (!aside) return;
    const { count, wait_min } = settings.get();
    const parts = [
      count > 0 ? t("threadReactionThresholds.count_summary", { n: count }) : "",
      wait_min > 0 ? waitLabel(wait_min) : "",
    ].filter(Boolean);
    aside.textContent = parts.join(" · ") || t("threadReactionThresholds.off");
  };
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
  const unsubscribeAside = settings.subscribe(() => {
    if (isOpen()) reflectAside();
  });
  return {
    reflect(): void {
      countStore.reflect();
      waitStore.reflect();
      reflectAside();
    },
    dispose(): void {
      unsubscribeAside();
      countStore.dispose();
      waitStore.dispose();
    },
  };
}
