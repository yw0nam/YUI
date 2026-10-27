/**
 * The unified chat window's composer — recipient chips over the message window's field under
 * createTextInput, and the @ list. It collects text and a recipient pick, and turns send into stop
 * while a reply runs; routing stays with the view.
 */

import type { PresetEntry } from "../../settings/preset/active-preset";
import { subscribe as subscribeLocale, t } from "../i18n";
import { createTextInput } from "../input/text-input";
import "../surfaces/surfaces.css";
import { avatarEl } from "./avatar";
import { createMentionPicker } from "./mention-picker";
import {
  countedMention,
  EVERYONE,
  type Mention,
  typedMention,
  typedMentionLength,
} from "./targets";

export interface Composer {
  /** The picked recipient, or null. */
  getMention(): Mention | null;
  /** The recipient a send names: the picked chip, else a typed leading @name; null leaves the fallback target to the routing. */
  getExplicitMention(): Mention | null;
  setMention(mention: Mention | null): void;
  /** Where Enter sends: the named recipient, else the fallback. */
  checked(): Mention | undefined;
  /** Fires when what checked() returns may have changed through the composer: a pick, the field's text. */
  onChange(cb: () => void): void;
  /** Names a recipient in the field's placeholder; undefined, or an empty cast, names none. */
  showRecipient(mention: Mention | undefined): void;
  /** Refreshes an open @ list and the recipient chips from the current cast. */
  refreshCast(): void;
  /** Puts text in the field, after what it holds, the way typing does; focus stays where it is. */
  fill(text: string): void;
  /** Drops the field's leading @name token, with its space, the way typing does; the rest stays. */
  consumeMentionToken(): void;
  /** text is trimmed and never empty. */
  onSubmit(cb: (text: string) => void): void;
  /** While busy, send becomes stop and Enter sends nothing. */
  setBusy(busy: boolean): void;
  onStop(cb: () => void): void;
  /** The inline error, with a button that fixes it in place when given. */
  showError(message: string, action?: { label: string; onClick(): void }): void;
  focus(): void;
  dispose(): void;
}

export function createComposer(deps: {
  mount: HTMLElement;
  cast: () => PresetEntry[];
  /** The recipient a message with no mention goes to; undefined while the cast is empty. */
  fallback: () => Mention | undefined;
}): Composer {
  const dock = deps.mount;
  dock.insertAdjacentHTML(
    "beforeend",
    `<div class="yui-uc__to" role="radiogroup"></div>
    <form class="yui-input" novalidate hidden>
      <div class="yui-input__tray"></div>
      <div class="yui-input__row">
        <button type="button" class="yui-input__btn yui-input__attach" hidden></button>
        <textarea class="yui-input__field" rows="1" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        <span class="yui-input__error" role="alert"></span>
        <button class="yui-input__btn yui-input__send" type="submit">
          <span class="icon-send" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg></span>
          <span class="icon-stop" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg></span>
        </button>
        <input type="file" class="yui-input__picker" hidden />
      </div>
    </form>`,
  );
  const q = <T extends HTMLElement>(sel: string): T => dock.querySelector<T>(sel)!;
  const form = q<HTMLFormElement>(".yui-input");
  const field = q<HTMLTextAreaElement>(".yui-input__field");
  const chipsEl = q<HTMLElement>(".yui-uc__to");

  let mention: Mention | null = null;
  const changeCbs: Array<() => void> = [];

  // The picker's capture listener is added first, so it sees Enter and Escape before the text input.
  const picker = createMentionPicker({ field, mount: dock, cast: deps.cast, onPick: setMention });
  // No summon hotkey here: a dismissed field opens again at once.
  const input = createTextInput(
    {
      formEl: form,
      field,
      errorEl: q(".yui-input__error"),
      trayEl: q(".yui-input__tray"),
      attachBtn: q(".yui-input__attach"),
      picker: q(".yui-input__picker"),
      sendBtn: q(".yui-input__send"),
    },
    { liftAboveInput() {}, resetPosition() {} },
    (open) => {
      if (!open) input.summonInput();
    },
  );
  input.summonInput();

  // The recipient a send names before the fallback: the counted pick, else a typed leading @name.
  function named(): Mention | null {
    const cast = deps.cast();
    return countedMention(mention, cast) ?? typedMention(field.value, cast);
  }

  // The checked chip is where Enter sends: the named recipient, else the fallback target.
  function checked(): Mention | undefined {
    return named() ?? deps.fallback();
  }

  function chip(id: Mention, label: string, entry?: PresetEntry): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yui-uc__recipient";
    button.setAttribute("role", "radio");
    button.dataset.id = id;
    if (entry) button.append(avatarEl(entry, 18));
    const name = document.createElement("span");
    name.textContent = label;
    button.append(name);
    return button;
  }

  function paint(): void {
    const on = checked();
    chipsEl.setAttribute("aria-label", t("unified.recipients"));
    chipsEl.replaceChildren(
      ...deps.cast().map((e) => chip(e.id, e.name, e)),
      chip(EVERYONE, t("unified.everyone")),
    );
    for (const button of chipsEl.querySelectorAll<HTMLElement>("[role=radio]"))
      button.setAttribute("aria-checked", String(button.dataset.id === on));
    for (const cb of changeCbs) cb();
  }

  function setMention(next: Mention | null): void {
    mention = next;
    paint();
  }

  const unsubscribeLocale = subscribeLocale(paint);
  const onChipClick = (e: MouseEvent): void => {
    const id = (e.target as Element).closest<HTMLElement>("[role=radio]")?.dataset.id;
    if (id === undefined) return;
    setMention(id);
    field.focus();
  };
  chipsEl.addEventListener("click", onChipClick);
  field.addEventListener("input", paint);
  paint();

  return {
    getMention: () => mention,
    getExplicitMention: () => named(),
    setMention,
    checked,
    onChange: (cb) => void changeCbs.push(cb),
    showRecipient(on) {
      const cast = deps.cast();
      const name = on === EVERYONE ? t("unified.everyone") : cast.find((e) => e.id === on)?.name;
      field.placeholder =
        name === undefined || cast.length === 0
          ? t("input.placeholder")
          : t("unified.placeholder_to", { name });
    },
    refreshCast() {
      picker.refresh();
      paint();
    },
    fill(text) {
      field.value = field.value ? `${field.value} ${text}` : text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    },
    consumeMentionToken() {
      const length = typedMentionLength(field.value, deps.cast());
      if (length === null) return;
      field.value = field.value.slice(length);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    },
    onSubmit: (cb) =>
      input.onSubmit((text) => {
        cb(text);
        // The field clears after the submit handlers, with no input event — the chips follow then.
        queueMicrotask(paint);
      }),
    setBusy: input.setBusy,
    onStop: input.onStop,
    showError: (message, action) => input.showInputError(message, action),
    focus: () => field.focus(),
    dispose() {
      unsubscribeLocale();
      picker.dispose();
      input.dispose();
      chipsEl.removeEventListener("click", onChipClick);
      field.removeEventListener("input", paint);
      chipsEl.remove();
      form.remove();
    },
  };
}
