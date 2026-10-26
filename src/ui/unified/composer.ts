/**
 * The unified chat window's composer — the message window's field markup under createTextInput,
 * plus the mention pill, the target chip, the hint and the @ list. It collects text and a recipient
 * pick; routing stays with the view.
 */

import type { PresetEntry } from "../../settings/preset/active-preset";
import { subscribe as subscribeLocale, t } from "../i18n";
import { createTextInput } from "../input/text-input";
import "../surfaces/surfaces.css";
import { avatarEl } from "./avatar";
import { createMentionPicker } from "./mention-picker";
import { countedMention, EVERYONE, type Mention, typedMention } from "./targets";

const CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`;
const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"></path></svg>`;

export interface Composer {
  /** The picked recipient, or null. */
  getMention(): Mention | null;
  setMention(mention: Mention | null): void;
  /** The preset a message with no mention goes to; undefined while the cast is empty. */
  setTarget(entry: PresetEntry | undefined): void;
  /** text is trimmed and never empty. */
  onSubmit(cb: (text: string) => void): void;
  dispose(): void;
}

export function createComposer(deps: { mount: HTMLElement; cast: () => PresetEntry[] }): Composer {
  const dock = deps.mount;
  dock.insertAdjacentHTML(
    "beforeend",
    `<form class="yui-input" novalidate hidden>
      <div class="yui-input__tray"></div>
      <div class="yui-uc__meta"><button class="yui-uc__target" type="button" aria-haspopup="listbox"></button><span class="yui-uc__hint"></span></div>
      <div class="yui-input__row">
        <button type="button" class="yui-input__btn yui-input__attach" hidden></button>
        <span class="yui-uc__pill" hidden></span>
        <textarea class="yui-input__field" rows="1" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        <span class="yui-input__error" role="alert"></span>
        <button class="yui-input__btn yui-input__send" type="submit">
          <span class="icon-send" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg></span>
        </button>
        <input type="file" class="yui-input__picker" hidden />
      </div>
    </form>`,
  );
  const q = <T extends HTMLElement>(sel: string): T => dock.querySelector<T>(sel)!;
  const form = q<HTMLFormElement>(".yui-input");
  const field = q<HTMLTextAreaElement>(".yui-input__field");
  const pill = q<HTMLElement>(".yui-uc__pill");
  const targetBtn = q<HTMLButtonElement>(".yui-uc__target");
  const hint = q<HTMLElement>(".yui-uc__hint");

  let mention: Mention | null = null;
  let target: PresetEntry | undefined;

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

  function paintPill(): void {
    pill.hidden = mention === null;
    pill.replaceChildren();
    if (mention === null) return;
    const entry = mention === EVERYONE ? undefined : deps.cast().find((e) => e.id === mention);
    if (entry) pill.append(avatarEl(entry, 14));
    pill.append(mention === EVERYONE ? `@${EVERYONE}` : `@${entry?.name ?? mention}`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "yui-uc__pill-x";
    remove.setAttribute("aria-label", t("unified.remove_mention"));
    remove.innerHTML = CROSS;
    remove.addEventListener("click", () => {
      setMention(null);
      field.focus();
    });
    pill.append(remove);
  }

  // The chip names where Enter sends: the counted pick, else a typed leading @name, else the fallback.
  const chipTarget = (): PresetEntry | typeof EVERYONE | undefined => {
    const cast = deps.cast();
    const m = countedMention(mention, cast) ?? typedMention(field.value, cast);
    if (m === null) return target;
    if (m === EVERYONE) return EVERYONE;
    return cast.find((e) => e.id === m);
  };

  function paintTarget(): void {
    const shown = chipTarget();
    targetBtn.replaceChildren();
    targetBtn.hidden = !shown;
    targetBtn.setAttribute("aria-disabled", String(countedMention(mention, deps.cast()) !== null));
    if (!shown) return;
    if (shown === EVERYONE) targetBtn.append(t("unified.to", { name: `@${EVERYONE}` }));
    else targetBtn.append(avatarEl(shown, 14), t("unified.to", { name: shown.name }));
    targetBtn.insertAdjacentHTML("beforeend", CHEVRON);
  }

  function setMention(next: Mention | null): void {
    mention = next;
    paintPill();
    paintTarget();
  }

  const paintHint = (): void => {
    hint.textContent = t("unified.hint");
  };
  paintHint();
  const unsubscribeLocale = subscribeLocale(() => {
    paintHint();
    paintPill();
    paintTarget();
  });

  const onFieldKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Backspace" && field.value === "" && mention !== null) {
      e.preventDefault();
      setMention(null);
    }
  };
  const onTargetClick = (): void => {
    if (mention === null) picker.openAll();
  };
  field.addEventListener("keydown", onFieldKeydown);
  field.addEventListener("input", paintTarget);
  targetBtn.addEventListener("click", onTargetClick);

  return {
    getMention: () => mention,
    setMention,
    setTarget(entry) {
      target = entry;
      paintTarget();
    },
    onSubmit: (cb) =>
      input.onSubmit((text) => {
        cb(text);
        // The field clears after the submit handlers, with no input event — the chip follows then.
        queueMicrotask(paintTarget);
      }),
    dispose() {
      unsubscribeLocale();
      picker.dispose();
      input.dispose();
      field.removeEventListener("keydown", onFieldKeydown);
      field.removeEventListener("input", paintTarget);
      targetBtn.removeEventListener("click", onTargetClick);
      form.remove();
    },
  };
}
