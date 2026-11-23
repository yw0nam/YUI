/** The card's fields, send switch, reset, greeting list and file actions. */

import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  CARD_FIELD_MAX_LEN,
  type Card,
  type PersonaConfig,
} from "../../../../config/validators/persona/types";
import { cardName, isUnnamedBuiltIn } from "../../../../io/chat/card/resolve-card";
import type { Logger } from "../../../../logger";
import type { createAgentSettings } from "../../../../settings/backend/agent-settings";
import type { PresetRegistry } from "../../../../settings/preset/preset-registry";
import { Disclosure } from "../../../controls/disclosure";
import { Switch } from "../../../controls/switch";
import { getLocale, LOCALE_DISPLAY_NAMES, t } from "../../../i18n";
import { avatarEl } from "../../../unified/avatar";
import { CARD_GUIDE_URL, PLUS_SVG } from "../../constants";
import { PushReason } from "../../sections/push-reason/push-reason";
import { setValue } from "../set-value";
import { cardBase, currentCard, presetEntry } from "./card-entry";
import { CardFileRow } from "./card-file-row";
import type { CardIo, CardIoPorts } from "./card-io";
import "./card-section.css";

type TextField =
  | "description"
  | "personality"
  | "scenario"
  | "first_mes"
  | "mes_example"
  | "system_prompt"
  | "post_history_instructions";

interface Stack {
  field: TextField;
  label: string;
  rows: number;
  sub?: string;
}

const STACKS: Stack[] = [
  { field: "description", label: "card.description", rows: 4 },
  { field: "personality", label: "card.personality", rows: 2 },
  { field: "scenario", label: "card.scenario", rows: 2 },
  { field: "first_mes", label: "card.greeting", rows: 2 },
];

const ADVANCED: Stack[] = [
  { field: "mes_example", label: "card.mes_example", rows: 4 },
  { field: "system_prompt", label: "card.system_prompt", rows: 4, sub: "card.system_prompt_sub" },
  { field: "post_history_instructions", label: "card.post_history", rows: 2 },
];

export function CardSection({
  agentSettings,
  registry,
  getPersona,
  isPushMode,
  io,
  importBusy,
  vrmSelection,
  speakerSelection,
  inspectPresetVrm,
  log,
  refresh,
}: {
  agentSettings: ReturnType<typeof createAgentSettings>;
  /** Renames the preset; absent where the panel shows no preset strip. */
  registry?: Pick<PresetRegistry, "rename">;
  /** The bundled config's default cards and fallback words; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  /** Whether push chat is the effective mode; on push only the file actions stay enabled. */
  isPushMode: () => boolean;
  io: CardIo;
  /** Whether this window's card import runs, and its changes. */
  importBusy: CardIoPorts["importBusy"];
  vrmSelection: Parameters<typeof CardFileRow>[0]["vrmSelection"];
  speakerSelection: Parameters<typeof CardFileRow>[0]["speakerSelection"];
  inspectPresetVrm: CardIoPorts["inspectPresetVrm"];
  log: Logger;
  /** Repaints the section from the stores and the edit's own card. */
  refresh(): void;
}) {
  const thumbRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const greetRefs = useRef(new Map<number, HTMLTextAreaElement>());

  const a = agentSettings.current();
  const push = isPushMode();
  const own = a.card !== null;
  const card = a.card ?? cardBase(getPersona);
  const shown = presetEntry();
  const hasPicture = Boolean(shown.thumbnail);
  // The user's Send card switch folds the body; on push the greetings stay reachable.
  const open = push || a.send_card;
  const help = t("card.help_aria");

  useLayoutEffect(() => {
    const name = nameRef.current;
    if (name && name.getAttribute("aria-invalid") !== "true") setValue(name, cardName(card, shown));
    for (const [field, el] of Object.entries(fieldRefs.current))
      setValue(el, card[field as TextField]);
    for (const [i, el] of greetRefs.current) setValue(el, card.alternate_greetings[i] ?? "");
    const thumb = thumbRef.current;
    if (thumb && hasPicture) thumb.replaceChildren(avatarEl(shown, 36));
  });

  function base(): Card {
    return cardBase(getPersona);
  }

  function onInput(e: FormEvent<HTMLDivElement>): void {
    const el = e.target as HTMLInputElement | HTMLTextAreaElement;
    const field = el.dataset.cardField as TextField | "name" | undefined;
    if (field && field !== "name") {
      agentSettings.updateCard({ [field]: el.value }, base());
    } else if (el.dataset.greetingIndex !== undefined) {
      const next = [...currentCard(agentSettings, getPersona).alternate_greetings];
      next[Number(el.dataset.greetingIndex)] = el.value;
      agentSettings.updateCard({ alternate_greetings: next }, base());
    }
  }

  // The name is one value in two places: the preset's, or the card's while the built-in preset is unnamed.
  const commitName = useCallback(() => {
    const name = nameRef.current;
    if (!name) return;
    const entry = presetEntry();
    const mark = (invalid: boolean): void => {
      name.closest(".yui-input-row")?.classList.toggle("is-invalid", invalid);
      name.setAttribute("aria-invalid", String(invalid));
    };
    // A refused name keeps what was typed and marks the row until a name is accepted; the registry's
    // own change notice must not redraw over it, so the row is marked before the rename runs.
    mark(true);
    let ok = true;
    if (isUnnamedBuiltIn(entry))
      agentSettings.updateCard({ name: name.value }, cardBase(getPersona));
    else ok = registry?.rename(entry.id, name.value) ?? true;
    mark(!ok);
    refresh();
  }, [agentSettings, registry, getPersona, refresh]);

  useEffect(() => {
    const name = nameRef.current;
    if (!name) return;
    name.addEventListener("change", commitName);
    return () => name.removeEventListener("change", commitName);
  }, [commitName]);

  function setGreetings(next: string[]): void {
    agentSettings.updateCard({ alternate_greetings: next }, base());
  }

  function addGreeting(): void {
    const next = [...currentCard(agentSettings, getPersona).alternate_greetings, ""];
    setGreetings(next);
    greetRefs.current.get(next.length - 1)?.focus();
  }

  function removeGreeting(index: number): void {
    setGreetings(
      currentCard(agentSettings, getPersona).alternate_greetings.filter((_, i) => i !== index),
    );
  }

  function toggleSend(): void {
    const enabled = !agentSettings.current().send_card;
    agentSettings.setSendCard(enabled);
    log.info("card_send_toggle", { enabled });
  }

  function resetCard(): void {
    agentSettings.resetCard();
    log.info("card_reset");
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the fields and greetings share one input handler
    <div className="yui-sec yui-card" onInput={onInput} onBlur={refresh}>
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">
          {t("card.label")}
          <a
            className="yui-hint-dot yui-card__help"
            href={CARD_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={help}
            data-tip={help}
          >
            ?
          </a>
        </h2>
        <span className="yui-sec__state" hidden={!open || own}>
          {t("card.default_state", { language: LOCALE_DISPLAY_NAMES[getLocale()] })}
        </span>
        <button className="yui-reset" type="button" hidden={!open || !own} onClick={resetCard}>
          {t("card.reset")}
        </button>
      </div>
      <div className="yui-group yui-group--switch">
        <div className="yui-row">
          <div className="yui-row__main">
            <span className="yui-row__label">{t("card.send_label")}</span>
            <span className="yui-row__sub">{t("card.send_sub")}</span>
            <PushReason reasonKey="push.reason_card" hidden={!push} />
          </div>
          <Switch
            className="yui-card-switch"
            checked={a.send_card}
            disabled={push}
            label={t("card.send_label")}
            onCheckedChange={toggleSend}
          />
        </div>
      </div>
      <div className="yui-card-body" hidden={!open}>
        <div className="yui-group">
          <div className="yui-card__namerow">
            <span className="yui-card-thumb" ref={thumbRef} hidden={!hasPicture} />
            <div className="yui-row yui-input-row">
              <div className="yui-row__main">
                <label className="yui-input-row__label" htmlFor="yui-card-name">
                  {t("card.name")}
                </label>
              </div>
              <div className="yui-input-wrap">
                <input
                  ref={nameRef}
                  className="yui-ep-input yui-card-name"
                  id="yui-card-name"
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  data-card-field="name"
                />
              </div>
            </div>
          </div>
          {STACKS.map(({ field, label, rows, sub }) => (
            <div className="yui-stack" key={field}>
              <label className="yui-input-row__label" htmlFor={`yui-card-${field}`}>
                {t(label)}
              </label>
              <textarea
                ref={(el) => {
                  fieldRefs.current[field] = el;
                }}
                className="yui-textarea"
                id={`yui-card-${field}`}
                data-card-field={field}
                spellCheck={false}
                rows={rows}
                maxLength={CARD_FIELD_MAX_LEN}
                disabled={push}
              />
              {sub && <p className="yui-row__sub">{t(sub)}</p>}
            </div>
          ))}
          {card.alternate_greetings.map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row is its position in the list
            <div className="yui-stack yui-card-greeting" key={i}>
              <div className="yui-card__greet-head">
                <label className="yui-input-row__label" htmlFor={`yui-card-greeting-${i}`}>
                  {t("card.greeting_n", { n: i + 2 })}
                </label>
                <button
                  className="yui-link-btn yui-card-greeting__remove"
                  type="button"
                  data-index={i}
                  disabled={push}
                  onClick={() => removeGreeting(i)}
                >
                  {t("card.greeting_remove")}
                </button>
              </div>
              <textarea
                ref={(el) => {
                  if (el) greetRefs.current.set(i, el);
                  else greetRefs.current.delete(i);
                }}
                className="yui-textarea"
                id={`yui-card-greeting-${i}`}
                data-greeting-index={i}
                spellCheck={false}
                rows={2}
                maxLength={CARD_FIELD_MAX_LEN}
                disabled={push}
              />
            </div>
          ))}
          <div className="yui-row yui-row--action yui-card-add-row">
            <button
              className="yui-add-btn yui-card-add"
              type="button"
              disabled={push}
              onClick={addGreeting}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with other surfaces
              dangerouslySetInnerHTML={{ __html: `${PLUS_SVG}${t("card.greeting_add")}` }}
            />
          </div>
        </div>
        <Disclosure label={t("card.advanced")}>
          <div className="yui-group">
            {ADVANCED.map(({ field, label, rows, sub }) => (
              <div className="yui-stack" key={field}>
                <label className="yui-input-row__label" htmlFor={`yui-card-${field}`}>
                  {t(label)}
                </label>
                <textarea
                  ref={(el) => {
                    fieldRefs.current[field] = el;
                  }}
                  className="yui-textarea"
                  id={`yui-card-${field}`}
                  data-card-field={field}
                  spellCheck={false}
                  rows={rows}
                  maxLength={CARD_FIELD_MAX_LEN}
                  disabled={push}
                />
                {sub && <p className="yui-row__sub">{t(sub)}</p>}
              </div>
            ))}
          </div>
        </Disclosure>
        <p className="yui-sec__foot">{t("card.macros")}</p>
      </div>
      <CardFileRow
        io={io}
        importBusy={importBusy}
        hasPicture={hasPicture}
        cardLabel={() => cardName(card, shown)}
        vrmSelection={vrmSelection}
        speakerSelection={speakerSelection}
        inspectPresetVrm={inspectPresetVrm}
        log={log}
      />
    </div>
  );
}
