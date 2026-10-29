/**
 * The answer area pinned at the thread pane's foot: the ask's prompt, numbered choices that toggle,
 * a one-line field that grows, and a send button named after what it sends.
 */

import "./answer-area.css";
import type { ThreadAsk } from "../../../contract";
import { t } from "../../i18n";
import type { Draft } from "./drafts";

/** The field grows with its text up to this height, then scrolls. */
const FIELD_MAX_PX = 200;
/** The keyCode a keydown carries while an IME composes, where `isComposing` is not set. */
const IME_KEYCODE = 229;

export interface AnswerArea {
  el: HTMLElement;
  /** Toggles the choice at `index`, as its number key does. */
  pick(index: number): void;
}

export function createAnswerArea(deps: {
  ask: ThreadAsk;
  draft: Draft;
  /** The last send's error, shown until the next send. */
  error: string | null;
  /** A send of this ask is in flight; send stays disabled until it settles. */
  sending: boolean;
  onDraft(draft: Draft): void;
  onSend(answer: { choice?: string; text?: string }): void;
}): AnswerArea {
  const { ask } = deps;
  const draft: Draft = { ...deps.draft };
  let sending = deps.sending;

  const el = document.createElement("section");
  el.className = "yui-threads-answer";
  el.setAttribute("aria-labelledby", "yui-threads-answer-prompt");
  el.innerHTML = `
    <div class="yui-threads-answer__head">
      <h3 id="yui-threads-answer-prompt"></h3>
    </div>
    <div class="yui-threads-answer__choices" role="group" aria-labelledby="yui-threads-answer-prompt"></div>
    <div class="yui-threads-answer__composer">
      <button type="button" class="yui-threads-answer__send"></button>
    </div>
  `;
  el.querySelector("h3")!.textContent = ask.prompt;
  const choicesEl = el.querySelector<HTMLElement>(".yui-threads-answer__choices")!;
  const composer = el.querySelector<HTMLElement>(".yui-threads-answer__composer")!;
  const send = el.querySelector<HTMLButtonElement>(".yui-threads-answer__send")!;

  const choiceButtons = ask.choices.map((choice, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("is-danger", choice.tone === "danger");
    const key = document.createElement("kbd");
    key.textContent = String(i + 1);
    button.append(key, choice.label);
    button.addEventListener("click", () => pick(i));
    return button;
  });
  choicesEl.append(...choiceButtons);
  choicesEl.hidden = choiceButtons.length === 0;

  let field: HTMLTextAreaElement | null = null;
  if (ask.text) {
    const hint = document.createElement("small");
    hint.id = "yui-threads-answer-hint";
    hint.textContent = t("threads.send_hint");
    el.querySelector(".yui-threads-answer__head")!.append(hint);
    field = document.createElement("textarea");
    field.rows = 1;
    field.value = draft.text;
    field.placeholder = ask.placeholder ?? "";
    field.setAttribute("aria-label", t("threads.reply_aria"));
    field.setAttribute("aria-describedby", hint.id);
    field.addEventListener("input", () => {
      draft.text = field!.value;
      deps.onDraft({ ...draft });
      grow();
      refresh();
    });
    field.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === IME_KEYCODE) return;
      e.preventDefault();
      submit();
    });
    composer.prepend(field);
  }

  if (deps.error) {
    const error = document.createElement("p");
    error.className = "yui-threads-answer__error";
    error.setAttribute("role", "alert");
    error.textContent = t("threads.send_failed", { error: deps.error });
    el.append(error);
  }

  function grow(): void {
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight + 2, FIELD_MAX_PX)}px`;
  }

  const text = (): string => (ask.text ? draft.text.trim() : "");
  const picked = () => ask.choices.find((c) => c.id === draft.choice);

  function refresh(): void {
    ask.choices.forEach((choice, i) => {
      choiceButtons[i]!.setAttribute("aria-pressed", String(choice.id === draft.choice));
    });
    const choice = picked();
    send.textContent = choice ? choice.label : t("threads.send");
    send.classList.toggle("is-danger", choice?.tone === "danger");
    send.disabled = sending || !(choice || text());
  }

  function pick(index: number): void {
    const choice = ask.choices[index];
    if (!choice) return;
    draft.choice = draft.choice === choice.id ? undefined : choice.id;
    deps.onDraft({ ...draft });
    refresh();
  }

  function submit(): void {
    const choice = picked();
    if (sending || !(choice || text())) return;
    sending = true;
    refresh();
    deps.onSend({ ...(choice ? { choice: choice.id } : {}), ...(text() ? { text: text() } : {}) });
  }

  send.addEventListener("click", submit);
  refresh();
  requestAnimationFrame(grow);
  return { el, pick };
}
