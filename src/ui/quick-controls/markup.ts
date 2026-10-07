/** Panel markup primitives shared by the template and the extracted tab modules. */
import { t } from "../i18n";

// Escapes the characters that would otherwise break out of an HTML attribute.
export function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Section title row — the title on the left, an optional control or state text on the right.
export function secHeadHtml(title: string, aside = ""): string {
  return `<div class="yui-sec__head"><h2 class="yui-sec__title">${title}</h2>${aside}</div>`;
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
