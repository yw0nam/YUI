/**
 * The settings window's character header: one button per preset with its face, name, transport and
 * window state. A click hands the preset to edit to `onPick`; a preset in no window is dimmed and
 * stays editable.
 */

import {
  effectiveChatApi,
  readChatApiOverride,
} from "../../../settings/backend/endpoints-settings";
import type { PresetEntry } from "../../../settings/preset/active-preset";
import { t } from "../../i18n";
import { avatarEl } from "../../unified/avatar";

export function createCharacterHeader(deps: {
  /** The preset the window edits. */
  shownId: string;
  getDefaultChatApi?: () => string | undefined;
  onPick: (id: string) => void;
}): {
  el: HTMLElement;
  render(list: readonly PresetEntry[], main: string, isOpen: (id: string) => boolean): void;
} {
  const el = document.createElement("div");
  el.className = "yui-chead";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", t("chars.section"));
  el.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-chead__item");
    if (item?.dataset.presetId && item.dataset.presetId !== deps.shownId)
      deps.onPick(item.dataset.presetId);
  });

  return {
    el,
    render(list, main, isOpen) {
      el.replaceChildren(
        ...list.map((entry) => {
          const state =
            entry.id === main ? "head.main" : isOpen(entry.id) ? "preset.window_open" : "head.off";
          const item = document.createElement("button");
          item.type = "button";
          item.className = "yui-chead__item";
          item.dataset.presetId = entry.id;
          item.classList.toggle("is-off", state === "head.off");
          item.setAttribute("aria-current", String(entry.id === deps.shownId));
          item.innerHTML = `<span class="yui-chead__text"><span class="yui-chead__name"></span><span class="yui-chead__meta"></span></span>`;
          item.prepend(avatarEl(entry, 28));
          item.querySelector(".yui-chead__name")!.textContent = entry.name;
          item.querySelector(".yui-chead__meta")!.textContent = t("head.meta", {
            transport: t(
              `svc.chat_name_${effectiveChatApi(readChatApiOverride(entry.id), deps.getDefaultChatApi?.())}`,
            ),
            state: t(state),
          });
          return item;
        }),
      );
    },
  };
}
