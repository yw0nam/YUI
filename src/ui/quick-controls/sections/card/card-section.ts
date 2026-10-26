/**
 * Card section of the Persona page: the markup, the field edits, the send switch, Reset to default
 * and the greeting list. It owns its subscriptions, redraws and teardown.
 */

import {
  CARD_FIELD_MAX_LEN,
  type Card,
  EMPTY_CARD,
  type PersonaConfig,
} from "../../../../config/validators/persona/types";
import type { ImportedCard } from "../../../../io/assets/card/card-import";
import { cardName, isUnnamedBuiltIn } from "../../../../io/chat/card/resolve-card";
import type { Logger } from "../../../../logger";
import type { createAgentSettings } from "../../../../settings/backend/agent-settings";
import type { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import {
  presetIdForWindow,
  readPresetEntry,
  readPresetName,
} from "../../../../settings/preset/active-preset";
import type { PresetRegistry } from "../../../../settings/preset/preset-registry";
import type { createFillerSettings } from "../../../../settings/voice/filler-settings";
import { getLocale, LOCALE_DISPLAY_NAMES, subscribe as subscribeLocale, t } from "../../../i18n";
import { CARD_GUIDE_URL } from "../../constants";
import { escapeAttr, secHeadHtml } from "../../markup";
import { pushReasonHtml } from "../push-reason/push-reason";
import { createCardIo } from "./card-io";
import "./card-section.css";

type TextField =
  | "description"
  | "personality"
  | "scenario"
  | "first_mes"
  | "mes_example"
  | "system_prompt"
  | "post_history_instructions";

const stackHtml = (field: TextField, labelKey: string, rows: number, subKey?: string): string => `
          <div class="yui-stack">
            <label class="yui-input-row__label" for="yui-card-${field}">${t(labelKey)}</label>
            <textarea class="yui-textarea" id="yui-card-${field}" data-card-field="${field}" spellcheck="false" rows="${rows}" maxlength="${CARD_FIELD_MAX_LEN}"></textarea>${subKey ? `<p class="yui-row__sub">${t(subKey)}</p>` : ""}
          </div>`;

const inputRowHtml = (id: string, labelKey: string, inputAttrs: string): string => `
          <div class="yui-row yui-input-row">
            <div class="yui-row__main"><label class="yui-input-row__label" for="${id}">${t(labelKey)}</label></div>
            <div class="yui-input-wrap"><input class="yui-ep-input ${id}" id="${id}" type="text" spellcheck="false" autocomplete="off" ${inputAttrs} /></div>
          </div>`;

const greetingHtml = (i: number): string => `
          <div class="yui-stack yui-card-greeting">
            <div class="yui-card__greet-head">
              <label class="yui-input-row__label" for="yui-card-greeting-${i}">${t("card.greeting_n", { n: i + 2 })}</label>
              <button class="yui-link-btn yui-card-greeting__remove" type="button" data-index="${i}">${t("card.greeting_remove")}</button>
            </div>
            <textarea class="yui-textarea" id="yui-card-greeting-${i}" data-greeting-index="${i}" spellcheck="false" rows="2" maxlength="${CARD_FIELD_MAX_LEN}"></textarea>
          </div>`;

const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const CHEVRON_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function cardSectionHtml(): string {
  const help = escapeAttr(t("card.help_aria"));
  const helpLink = `<a class="yui-hint-dot yui-card__help" href="${CARD_GUIDE_URL}" target="_blank" rel="noopener noreferrer" aria-label="${help}" data-tip="${help}">?</a>`;
  return `
        <div class="yui-sec yui-card">
          ${secHeadHtml(
            `${t("card.label")}${helpLink}`,
            `<span class="yui-sec__state"></span><button class="yui-reset" type="button">${t("card.reset")}</button>`,
          )}
          <div class="yui-group yui-group--switch">
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">${t("card.send_label")}</span>
                <span class="yui-row__sub">${t("card.send_sub")}</span>${pushReasonHtml("push.reason_card")}
              </div>
              <button class="yui-switch yui-card-switch" type="button" role="switch" aria-checked="true" aria-label="${t("card.send_label")}"></button>
            </div>
          </div>
          <div class="yui-card-body">
            <div class="yui-group"><div class="yui-card__namerow"><img class="yui-card-thumb" alt="" hidden />${inputRowHtml("yui-card-name", "card.name", 'data-card-field="name"')}</div>${stackHtml("description", "card.description", 4)}${stackHtml("personality", "card.personality", 2)}${stackHtml("scenario", "card.scenario", 2)}${stackHtml("first_mes", "card.greeting", 2)}
              <div class="yui-row yui-row--action yui-card-add-row">
                <button class="yui-add-btn yui-card-add" type="button">${PLUS_SVG}${t("card.greeting_add")}</button>
              </div>
            </div>
            <details class="yui-more">
              <summary>${CHEVRON_SVG}${t("card.advanced")}</summary>
              <div class="yui-group">${stackHtml("mes_example", "card.mes_example", 4)}${stackHtml("system_prompt", "card.system_prompt", 4, "card.system_prompt_sub")}${stackHtml("post_history_instructions", "card.post_history", 2)}
              </div>
            </details>
            <p class="yui-sec__foot">${t("card.macros")}</p>
          </div>
          <div class="yui-row yui-row--action yui-card__io">
            <button class="yui-link-btn yui-card-import" type="button">${t("card.import")}</button>
            <button class="yui-link-btn yui-card-export" type="button">${t("card.export")}</button>
          </div>
          <p class="yui-row__sub yui-card__io-note">${t("card.io_note")}</p>
          <p class="yui-card__io-error" role="status" hidden></p>
        </div>`;
}

type AgentSettingsStore = ReturnType<typeof createAgentSettings>;
type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
type FillerSettingsStore = ReturnType<typeof createFillerSettings>;

interface CardSectionDeps {
  /** Panel root holding the section's markup. */
  root: HTMLElement;
  agentSettings: AgentSettingsStore;
  endpointsSettings: Pick<EndpointsSettingsStore, "subscribe">;
  /** Renames the preset; absent where the panel shows no preset strip. */
  registry?: Pick<PresetRegistry, "rename" | "subscribe">;
  /** The bundled config's default cards and fallback words; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  /** Whether push chat is the effective mode; on push only the card import and export stay. */
  isPushMode: () => boolean;
  /** Popover open state: store subscriptions redraw only while the panel is open. */
  isOpen: () => boolean;
  /** Card file steps and the preset creator, wired by the app layer. */
  importCard: () => Promise<ImportedCard | null>;
  exportCard: (text: string, fileName: string) => Promise<"written" | "cancelled">;
  createPresetFromCard: (card: Card, thumbnailTempId?: string) => Promise<string>;
  /** Filler pools the card export carries. */
  fillerSettings: Pick<FillerSettingsStore, "get">;
  log: Logger;
}

interface CardSection {
  /** Render every control from the stores and the UI language. */
  reflect(): void;
  /** Permanent teardown: unsubscribe and remove all listeners. */
  dispose(): void;
}

export function createCardSection(deps: CardSectionDeps): CardSection {
  const { root, agentSettings, endpointsSettings, registry, getPersona, isPushMode, isOpen, log } =
    deps;
  const sec = root.querySelector<HTMLElement>(".yui-card")!;
  const q = <T extends HTMLElement>(sel: string): T => sec.querySelector<T>(sel)!;
  const body = q<HTMLElement>(".yui-card-body");
  const switchBtn = q<HTMLButtonElement>(".yui-card-switch");
  const pushReason = q<HTMLElement>(".yui-push-reason");
  const stateEl = q<HTMLElement>(".yui-sec__state");
  const resetBtn = q<HTMLButtonElement>(".yui-reset");
  const nameEl = q<HTMLInputElement>('[data-card-field="name"]');
  const addRow = q<HTMLElement>(".yui-card-add-row");
  const fields = Array.from(sec.querySelectorAll<HTMLTextAreaElement>("textarea[data-card-field]"));

  const entry = () => {
    const id = presetIdForWindow();
    return readPresetEntry(id) ?? { id, name: readPresetName(id) };
  };
  // The default card of the UI language: what a first edit starts from.
  const base = (): Card => getPersona?.()?.cards[getLocale()] ?? EMPTY_CARD;
  const greetings = (): HTMLTextAreaElement[] =>
    Array.from(sec.querySelectorAll<HTMLTextAreaElement>("textarea[data-greeting-index]"));

  // A focused control keeps what the user is typing; it catches up on blur.
  function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    if (document.hasFocus() && document.activeElement === el) return;
    if (el.value !== value) el.value = value;
  }

  function reflect(): void {
    const push = isPushMode();
    pushReason.hidden = !push;
    switchBtn.disabled = push;
    // Push never sends the card, greetings included; the name is the preset's own and stays.
    for (const el of fields) el.disabled = push;
    const a = agentSettings.get();
    const card = a.card ?? base();
    const own = a.card !== null;
    const shown = entry();
    const thumb = q<HTMLImageElement>(".yui-card-thumb");
    thumb.hidden = !shown.thumbnail;
    if (shown.thumbnail) thumb.src = shown.thumbnail;
    switchBtn.setAttribute("aria-checked", String(a.send_card));
    // The user's Send card switch folds the body; on push the greetings stay reachable.
    const open = push || a.send_card;
    body.hidden = !open;
    stateEl.hidden = !open || own;
    stateEl.textContent = t("card.default_state", { language: LOCALE_DISPLAY_NAMES[getLocale()] });
    resetBtn.hidden = !open || !own;
    if (nameEl.getAttribute("aria-invalid") !== "true") setValue(nameEl, cardName(card, shown));
    for (const el of fields) setValue(el, card[el.dataset.cardField as TextField]);
    const list = card.alternate_greetings;
    if (greetings().length !== list.length) {
      for (const node of sec.querySelectorAll(".yui-card-greeting")) node.remove();
      addRow.insertAdjacentHTML("beforebegin", list.map((_, i) => greetingHtml(i)).join(""));
    }
    greetings().forEach((el, i) => {
      setValue(el, list[i] ?? "");
      el.disabled = push;
    });
    for (const btn of sec.querySelectorAll<HTMLButtonElement>(
      ".yui-card-greeting__remove, .yui-card-add",
    ))
      btn.disabled = push;
  }

  const currentCard = (): Card => agentSettings.get().card ?? base();

  const io = createCardIo({
    errorEl: q<HTMLElement>(".yui-card__io-error"),
    ports: {
      importCard: deps.importCard,
      exportCard: deps.exportCard,
      createPresetFromCard: deps.createPresetFromCard,
    },
    currentCard,
    entry,
    fillerPools: () => deps.fillerSettings.get().customPools,
    log,
  });

  function setGreetings(next: string[]): void {
    agentSettings.updateCard({ alternate_greetings: next }, base());
    reflect();
  }

  function handleInput(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLTextAreaElement;
    const field = el.dataset.cardField as TextField | "name" | undefined;
    if (field && field !== "name") {
      agentSettings.updateCard({ [field]: el.value }, base());
    } else if (el.dataset.greetingIndex !== undefined) {
      const next = [...currentCard().alternate_greetings];
      next[Number(el.dataset.greetingIndex)] = el.value;
      agentSettings.updateCard({ alternate_greetings: next }, base());
    }
  }

  // The name is one value in two places: the preset's, or the card's while the built-in preset is unnamed.
  function handleChange(e: Event): void {
    if (e.target !== nameEl) return;
    const e0 = entry();
    const mark = (invalid: boolean): void => {
      nameEl.closest(".yui-input-row")?.classList.toggle("is-invalid", invalid);
      nameEl.setAttribute("aria-invalid", String(invalid));
    };
    // A refused name keeps what was typed and marks the row until a name is accepted; the registry's
    // own change notice must not redraw over it, so the row is marked before the rename runs.
    mark(true);
    let ok = true;
    if (isUnnamedBuiltIn(e0)) agentSettings.updateCard({ name: nameEl.value }, base());
    else ok = registry?.rename(e0.id, nameEl.value) ?? true;
    mark(!ok);
    reflect();
  }

  function handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest(".yui-card__io")) {
      io.handle(e);
      return;
    }
    if (target.closest(".yui-card-switch")) {
      const enabled = !agentSettings.get().send_card;
      agentSettings.setSendCard(enabled);
      log.info("card_send_toggle", { enabled });
    } else if (target.closest(".yui-reset")) {
      agentSettings.resetCard();
      log.info("card_reset");
    } else if (target.closest(".yui-card-add")) {
      setGreetings([...currentCard().alternate_greetings, ""]);
      greetings().at(-1)?.focus();
    } else {
      const remove = target.closest<HTMLElement>(".yui-card-greeting__remove");
      if (remove)
        setGreetings(
          currentCard().alternate_greetings.filter((_, i) => i !== Number(remove.dataset.index)),
        );
    }
    reflect();
  }

  const redraw = (): void => {
    if (isOpen()) reflect();
  };
  const unsubscribes = [
    agentSettings.subscribe(redraw),
    endpointsSettings.subscribe(redraw),
    registry?.subscribe(redraw),
    subscribeLocale(redraw),
  ];

  sec.addEventListener("input", handleInput);
  sec.addEventListener("change", handleChange);
  sec.addEventListener("click", handleClick);
  sec.addEventListener("focusout", reflect);

  return {
    reflect,
    dispose(): void {
      for (const off of unsubscribes) off?.();
      sec.removeEventListener("input", handleInput);
      sec.removeEventListener("change", handleChange);
      sec.removeEventListener("click", handleClick);
      sec.removeEventListener("focusout", reflect);
    },
  };
}
