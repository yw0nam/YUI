import type { AgentNotifySettingsStore } from "../../../../settings/backend/agent-notify-settings";
import {
  THREAD_TURNS,
  type ThreadTurnsSettingsStore,
} from "../../../../settings/threads/thread-turns-settings";
import { t } from "../../../i18n";
import { createStoreSegment } from "../../store-segment";

export function threadTurnsRowHtml(): string {
  const cells = THREAD_TURNS.map(
    (level) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-level="${level}" aria-checked="false" tabindex="-1">${t(`threadTurns.${level}`)}</button>`,
  ).join("");
  return `
          <div class="yui-row yui-threadturns-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t("threadTurns.label")}</span>
              <span class="yui-row__sub">${t("threadTurns.sub")}</span>
              <span class="yui-row__sub yui-threadturns-reason" hidden>${t("threadTurns.disabled_reason")}</span>
            </div>
            <div class="yui-seg yui-threadturns-seg" role="radiogroup" aria-label="${t("threadTurns.aria")}">${cells}</div>
          </div>`;
}

/** Binds the Thread turns segment to its store; the cells and the reason follow External signals. */
export function createThreadTurnsRow(deps: {
  root: HTMLElement;
  threadTurnsSettings: ThreadTurnsSettingsStore;
  agentNotifySettings: AgentNotifySettingsStore;
  isOpen: () => boolean;
}) {
  const { root, threadTurnsSettings, agentNotifySettings, isOpen } = deps;
  const segment = root.querySelector<HTMLElement>(".yui-threadturns-seg")!;
  const reason = root.querySelector<HTMLElement>(".yui-threadturns-reason")!;
  const store = createStoreSegment({
    segment,
    values: THREAD_TURNS,
    get: () => threadTurnsSettings.get().level,
    set: threadTurnsSettings.setLevel,
    subscribe: threadTurnsSettings.subscribe,
    isOpen,
  });
  const reflectEnabled = (): void => {
    const enabled = agentNotifySettings.get().enabled;
    for (const button of segment.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"))
      button.disabled = !enabled;
    reason.hidden = enabled;
  };
  const unsubscribe = agentNotifySettings.subscribe(() => {
    if (isOpen()) reflectEnabled();
  });
  return {
    reflect(): void {
      store.reflect();
      reflectEnabled();
    },
    dispose(): void {
      unsubscribe();
      store.dispose();
    },
  };
}
