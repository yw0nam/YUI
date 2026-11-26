/** Renders a Settings request in the Ask slot: Deny or Allow on one click, a checkbox per change when there are several, and an optional note; its owner decides when it closes. */

import "./settings-request-card.css";
import { oneLine } from "../../io/chat/one-line";
import {
  NOTE_MAX,
  type SettingsRequestDecision,
  type SettingsRequestFrame,
} from "../../io/chat/tools/run/settings-request-frame";
import { countdown } from "../ask/countdown";
import { t } from "../i18n";
import { changeLine, whyLine } from "./change-lines";

const IME_KEYCODE = 229;
// The time left takes the danger color under this many seconds.
const LOW_S = 10;

export interface SettingsRequestCard {
  /** Draws this request, or hides on undefined; the same request_id keeps the DOM, the checks, the note and focus. */
  set(frame: SettingsRequestFrame | undefined): void;
  onDecision(cb: (decision: SettingsRequestDecision) => boolean): void;
  dispose(): void;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function createSettingsRequestCard(deps: { mount: HTMLElement }): SettingsRequestCard {
  const handlers: Array<(decision: SettingsRequestDecision) => boolean> = [];
  let shownId: string | undefined;
  let timer: HTMLElement | undefined;
  let stopCountdown = (): void => {};

  const el = make("section", "yui-ask-card yui-settings-card");
  el.hidden = true;
  deps.mount.append(el);

  function render(frame: SettingsRequestFrame): void {
    const several = frame.changes.length > 1;
    const name = oneLine(frame.name);

    const head = make("div", "yui-settings-card__head");
    timer = make("span", "yui-ask-card__timer yui-settings-card__timer");
    timer.setAttribute("role", "timer");
    head.append(
      make("h3", "yui-settings-card__title", t("settings_request.title", { name })),
      timer,
    );

    const body = make("div", "yui-settings-card__body");
    const boxes = frame.changes.map(() => {
      const box = make("input", "yui-settings-card__check");
      box.type = "checkbox";
      return box;
    });
    if (several) {
      const list = make("div", "yui-settings-card__list");
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", t("settings_request.changes_aria"));
      frame.changes.forEach((change, i) => {
        const item = make("label", "yui-settings-card__item");
        item.append(boxes[i]!, make("span", "", changeLine(change)));
        list.append(item);
      });
      body.append(list);
    } else {
      body.append(make("p", "yui-settings-card__change", changeLine(frame.changes[0]!)));
    }
    const why = whyLine(frame.why);
    if (why) body.append(make("p", "yui-settings-card__why", why));
    body.append(make("p", "yui-settings-card__shared", t("settings_request.shared")));

    const note = make("div", "yui-settings-card__note");
    note.hidden = true;
    const field = make("textarea", "yui-settings-card__field");
    field.rows = 1;
    field.placeholder = t("settings_request.note_placeholder");
    field.setAttribute("aria-label", t("settings_request.note_aria", { name }));
    const hint = make("small", "yui-settings-card__hint");
    hint.id = "yui-settings-card-hint";
    field.setAttribute("aria-describedby", hint.id);
    note.append(field, hint);

    const actions = make("div", "yui-settings-card__actions");
    const link = make("button", "yui-settings-card__link", t("settings_request.add_note"));
    const deny = make("button", "yui-settings-card__button", t("settings_request.deny"));
    const allow = make("button", "yui-settings-card__button yui-settings-card__allow");
    for (const button of [link, deny, allow]) button.type = "button";
    actions.append(link, deny, allow);

    const checked = (): string[] =>
      frame.changes.filter((_, i) => boxes[i]!.checked).map((change) => change.path);
    function refresh(): void {
      const n = checked().length;
      allow.textContent =
        several && n > 0 ? t("settings_request.allow_count", { n }) : t("settings_request.allow");
      allow.disabled = several && n === 0;
      const action = several && n > 0 ? allow.textContent : deny.textContent;
      hint.textContent = t("settings_request.enter_hint", { action });
    }
    function emit(paths: string[]): void {
      const text = field.value.trim();
      const decision = { request_id: frame.request_id, allow: paths };
      for (const cb of handlers) cb(text ? { ...decision, note: text } : decision);
    }
    const allowed = (): string[] => (several ? checked() : [frame.changes[0]!.path]);
    function grow(): void {
      field.style.height = "auto";
      // An empty field keeps its one-line minimum; the stylesheet caps the height at four lines.
      if (field.value) field.style.height = `${field.scrollHeight + 2}px`;
      else field.style.height = "";
    }

    for (const box of boxes) box.addEventListener("change", refresh);
    link.addEventListener("click", () => {
      note.hidden = false;
      link.hidden = true;
      field.focus();
    });
    deny.addEventListener("click", () => emit([]));
    allow.addEventListener("click", () => emit(allowed()));
    field.addEventListener("input", () => {
      const cut = [...field.value].slice(0, NOTE_MAX).join("");
      if (cut !== field.value) field.value = cut;
      grow();
    });
    field.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === IME_KEYCODE) return;
      e.preventDefault();
      emit(several && checked().length > 0 ? checked() : []);
    });

    refresh();
    el.setAttribute("aria-label", t("settings_request.label"));
    el.replaceChildren(head, body, note, actions);
  }

  return {
    set(frame) {
      stopCountdown();
      el.hidden = !frame;
      if (!frame) {
        el.replaceChildren();
        shownId = undefined;
        return;
      }
      if (frame.request_id !== shownId) render(frame);
      shownId = frame.request_id;
      const shown = timer!;
      stopCountdown = countdown(shown, frame.expires_at, (s) => {
        shown.classList.toggle("is-low", s < LOW_S);
      });
    },
    onDecision(cb) {
      handlers.push(cb);
    },
    dispose() {
      stopCountdown();
      el.remove();
    },
  };
}
