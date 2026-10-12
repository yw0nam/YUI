/** Panel markup primitives shared by the template and the extracted tab modules. */
import type { EndpointOverrides } from "../../settings/backend/endpoints-settings";
import { t } from "../i18n";
import { CHATKEY_CLEAR_SVG, CHATKEY_EYE_SVG, ENDPOINT_FIELDS } from "./constants";

// Escapes the characters that would otherwise break out of an HTML attribute.
export function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Section title row — the title on the left, an optional control or state text on the right.
export function secHeadHtml(title: string, aside = ""): string {
  return `<div class="yui-sec__head"><h2 class="yui-sec__title">${title}</h2>${aside}</div>`;
}

// Select row — label on the left, the control markup (a select, its wrapper, a description line) after it.
export function selectRowHtml(id: string, labelKey: string, controlHtml: string): string {
  return `
          <div class="yui-row">
            <div class="yui-row__main"><label class="yui-input-row__label" for="${id}">${t(labelKey)}</label></div>
            ${controlHtml}
          </div>`;
}

// Endpoint field row template. Label/placeholder/value left empty, filled by the tab's reflect.
// Use type="text" and control validation message directly (avoid browser default URL validation).
export function endpointRowHtml(key: keyof EndpointOverrides): string {
  const def = ENDPOINT_FIELDS.find((f) => f.key === key)!;
  const errId = `yui-ep-err-${key}`;
  const urlClass = def.url ? " yui-ep-input--url" : "";
  const errHtml = def.url
    ? `<p class="yui-input-row__error" id="${errId}" role="status">${t("endpoints.url_error")}</p>`
    : "";
  return `
          <div class="yui-row yui-input-row" data-ep-field="${key}">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="yui-ep-${key}">${t(def.labelKey)}</label>
              <span class="yui-input-row__sub">${t("endpoints.field_sub")}</span>
            </div>
            <div class="yui-input-wrap">
              <input class="yui-ep-input${urlClass}" id="yui-ep-${key}" type="text" spellcheck="false"
                inputmode="${def.url ? "url" : "text"}" autocapitalize="off" autocomplete="off" />
            </div>
            ${errHtml}
          </div>`;
}

// Per-service API key row (secret). Uses idPrefix to stamp chat/stt/tts from one template.
// Input always type="password" — toggle reveals plaintext only. value/sublabel filled by reflect.
export function keyRowHtml(idPrefix: string): string {
  return `
          <div class="yui-row yui-input-row yui-chatkey" data-key-prefix="${idPrefix}">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="yui-${idPrefix}-input">${t(`${idPrefix}.label`)}</label>
              <span class="yui-input-row__sub"></span>
            </div>
            <div class="yui-input-wrap yui-chatkey__wrap">
              <input class="yui-ep-input yui-chatkey__input" id="yui-${idPrefix}-input" type="password"
                autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t(`${idPrefix}.label`)}" />
              <button class="yui-iconbtn yui-chatkey__toggle" type="button" aria-pressed="false" aria-label="${t(`${idPrefix}.show`)}" data-tip="${t(`${idPrefix}.show`)}">${CHATKEY_EYE_SVG}</button>
              <button class="yui-iconbtn yui-chatkey__clear" type="button" aria-label="${t(`${idPrefix}.clear`)}" data-tip="${t(`${idPrefix}.clear`)}">${CHATKEY_CLEAR_SVG}</button>
            </div>
          </div>`;
}

// Per-service reset — a text button closing the service's group.
export function svcResetRowHtml(svc: string): string {
  return `
          <div class="yui-row yui-row--action">
            <button class="yui-link-btn yui-svc-reset" type="button" data-svc-reset="${svc}">${t(`svc.reset_${svc}`)}</button>
          </div>`;
}

// Numeric input row: label+sub(+hint) on the left, number input with its unit on the right.
export function numRowHtml(opts: {
  id: string;
  labelKey: string;
  subKey?: string;
  min: number;
  max: number;
  suffixKey?: string;
  hintKey?: string;
}): string {
  const { id, labelKey, subKey, min, max, suffixKey, hintKey } = opts;
  const subHtml = subKey ? `<span class="yui-input-row__sub">${t(subKey)}</span>` : "";
  const suffixHtml = suffixKey ? `<span class="yui-cue__suffix">${t(suffixKey)}</span>` : "";
  const hintHtml = hintKey ? `<span class="yui-row__sub">${t(hintKey)}</span>` : "";
  return `
          <div class="yui-row">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="${id}">${t(labelKey)}</label>
              ${subHtml}${hintHtml}
            </div>
            <div class="yui-num">
              <input class="yui-num-input" id="${id}" type="number" min="${min}" max="${max}" inputmode="numeric" />
              ${suffixHtml}
            </div>
          </div>`;
}
