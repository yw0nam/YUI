/** Renders the oldest supplied Ask above the input with its countdown, choices and draft; the session owns when it closes. */

import "./ask-card.css";
import type { AskAnswer, AskFrame } from "../../io/chat/push/push-frames";
import { t } from "../i18n";
import { markClipped } from "../scroll-fade/scroll-fade";
import { type AnswerArea, createAnswerArea } from "../threads/window/answer-area";
import type { Draft } from "../threads/window/drafts";

export interface AskCard {
  /** Keeps DOM, focus and draft for an unchanged head; head changes, local failures and post-answer replay re-render it. */
  set(frames: AskFrame[]): void;
  /** Appends an Answer handler; the first handler supplies the send result. */
  onAnswer(cb: (answer: AskAnswer) => boolean): void;
  dispose(): void;
}

export function createAskCard(deps: { mount: HTMLElement }): AskCard {
  const answerHandlers: Array<(answer: AskAnswer) => boolean> = [];
  let head: AskFrame | undefined;
  let answered = false;
  let area: AnswerArea | null = null;
  let shownId: string | null = null;
  let draft: Draft = { picks: [], text: "" };
  let tick: ReturnType<typeof setTimeout> | undefined;

  const el = document.createElement("section");
  el.className = "yui-ask-card";
  el.hidden = true;
  const timer = document.createElement("span");
  timer.className = "yui-ask-card__timer";
  timer.setAttribute("role", "timer");
  deps.mount.append(el);

  function render(error: string | null = null): void {
    clearTimeout(tick);
    answered = false;
    const frame = head;
    el.hidden = !frame;
    if (!frame) {
      el.replaceChildren();
      area = null;
      shownId = null;
      return;
    }
    if (frame.ask.ask_id !== shownId) draft = { picks: [], text: "" };
    shownId = frame.ask.ask_id;
    el.setAttribute("aria-label", t("ask.label"));
    area = createAnswerArea({
      ask: frame.ask,
      draft,
      error,
      sending: false,
      onDraft: (next) => {
        draft = next;
      },
      onSend: (answer) => {
        answered = true;
        const [sent] = answerHandlers.map((cb) => cb({ ask_id: frame.ask.ask_id, ...answer }));
        if (!sent) render(t("ask.not_sent"));
      },
      head: timer,
    });
    el.replaceChildren(area.el);
    countDown();
  }

  // Each tick lands where the shown seconds change, so the last one lands on expires_at.
  function countDown(): void {
    const frame = head!;
    const { expires_at } = frame;
    timer.hidden = expires_at === undefined;
    if (expires_at === undefined) {
      cue();
      return;
    }
    const left = expires_at - Date.now();
    const s = Math.max(0, Math.ceil(left / 1000));
    const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    timer.textContent = t("ask.time_left", { time });
    cue();
    if (left > 0) tick = setTimeout(countDown, left - (s - 1) * 1000);
  }

  // The prompt head, where the timer rides, marks itself while more of it sits below; a render, a scroll and each tick of a deadline re-measure it.
  function cue(): void {
    if (timer.parentElement) markClipped(timer.parentElement);
  }
  // Scroll does not bubble, so the card catches the head's on capture.
  el.addEventListener("scroll", cue, true);

  // Typing in the field keeps its keys, and a shortcut is not a choice.
  el.addEventListener("keydown", (e) => {
    const target = e.target as Element;
    if (target.closest("textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!/^[1-9]$/.test(e.key)) return;
    e.preventDefault();
    area?.pick(Number(e.key) - 1);
  });

  return {
    set(frames) {
      const next = frames[0];
      if (!answered && JSON.stringify(head) === JSON.stringify(next)) return;
      head = next;
      render();
    },
    onAnswer(cb) {
      answerHandlers.push(cb);
    },
    dispose() {
      clearTimeout(tick);
      el.remove();
    },
  };
}
