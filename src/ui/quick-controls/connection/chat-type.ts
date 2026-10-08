/**
 * Chat type row — a native select whose open list carries the long option names, a text overlay
 * that shows the short name on the closed control, and a description line under the row.
 */
import { t } from "../../i18n";
import { CHAT_APIS, type ChatApi } from "../constants";
import "./chat-type.css";

const nameKey = (api: ChatApi) => `svc.chat_name_${api}`;

export function chatTypeRowHtml(): string {
  const options = CHAT_APIS.map(
    (a) => `<option value="${a}">${t(`svc.chat_option_${a}`)}</option>`,
  ).join("");
  return `
          <div class="yui-row">
            <div class="yui-row__main"><label class="yui-input-row__label" for="yui-svc-chat-type">${t("svc.type_label")}</label></div>
            <div class="yui-select-wrap">
              <select class="yui-select yui-chat-type" id="yui-svc-chat-type" aria-label="${t("svc.chat_aria")}">${options}</select>
              <span class="yui-chat-type__shown" aria-hidden="true"></span>
            </div>
            <p class="yui-chat-type__desc" aria-live="polite"></p>
          </div>`;
}

/** Writes the selected type onto the overlay, the description line and the section's summary hint. */
export function createChatTypeView(root: HTMLElement): { reflect(api: ChatApi): void } {
  const shown = root.querySelector<HTMLElement>(".yui-chat-type__shown");
  const desc = root.querySelector<HTMLElement>(".yui-chat-type__desc");
  const hint = root.querySelector<HTMLElement>(".yui-chat-summary-hint");
  return {
    reflect(api) {
      if (shown) shown.textContent = t(nameKey(api));
      if (hint) hint.textContent = t(nameKey(api));
      if (!desc) return;
      const next = t(`svc.chat_desc_${api}`);
      if (desc.textContent === next) return;
      const first = desc.textContent === "";
      desc.textContent = next;
      desc.classList.remove("is-swapping");
      if (first) return;
      void desc.offsetWidth;
      desc.classList.add("is-swapping");
    },
  };
}
