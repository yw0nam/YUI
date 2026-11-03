/**
 * The pet window's Ask card: the backend's open Asks in arrival order, the oldest shown in the
 * Threads answer area with the time it has left, when it has a deadline. An Ask closes once
 * answered, at its expiry, or when the backend ends it; with none left the card hides.
 */

import "./ask-card.css";
import type { AskFrame } from "../../io/chat/push/push-frames";
import { t } from "../i18n";
import { markClipped } from "../scroll-fade/scroll-fade";
import { type AnswerArea, createAnswerArea } from "../threads/window/answer-area";
import type { Draft } from "../threads/window/drafts";

export interface AskCard {
  /** Holds the Ask, replacing the one with the same `ask_id` in place. */
  show(frame: AskFrame): void;
  /** The backend closed the Ask without the user's answer. */
  end(askId: string): void;
  clear(): void;
  dispose(): void;
}

export function createAskCard(deps: {
  mount: HTMLElement;
  /** False when the answer could not be sent; the Ask stays open. */
  onAnswer(answer: { ask_id: string; choice?: string; text?: string }): boolean;
}): AskCard {
  const open: AskFrame[] = [];
  let area: AnswerArea | null = null;
  let shownId: string | null = null;
  let draft: Draft = { text: "" };
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
    const frame = open[0];
    el.hidden = !frame;
    if (!frame) {
      el.replaceChildren();
      area = null;
      shownId = null;
      return;
    }
    if (frame.ask.ask_id !== shownId) draft = { text: "" };
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
        if (deps.onAnswer({ ask_id: frame.ask.ask_id, ...answer })) close(frame.ask.ask_id);
        else render(t("ask.not_sent"));
      },
      head: timer,
    });
    el.replaceChildren(area.el);
    countDown();
  }

  // Each tick lands where the shown seconds change, so the last one lands on expires_at.
  function countDown(): void {
    const frame = open[0]!;
    const { expires_at } = frame;
    timer.hidden = expires_at === undefined;
    if (expires_at === undefined) {
      cue();
      return;
    }
    const left = expires_at - Date.now();
    if (left <= 0) {
      close(frame.ask.ask_id);
      return;
    }
    const s = Math.ceil(left / 1000);
    const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    timer.textContent = t("ask.time_left", { time });
    cue();
    tick = setTimeout(countDown, left - (s - 1) * 1000);
  }

  // The prompt head, where the timer rides, marks itself while more of it sits below; a render, a scroll and each tick of a deadline re-measure it.
  function cue(): void {
    if (timer.parentElement) markClipped(timer.parentElement);
  }
  // Scroll does not bubble, so the card catches the head's on capture.
  el.addEventListener("scroll", cue, true);

  function close(askId: string): void {
    const i = open.findIndex((f) => f.ask.ask_id === askId);
    if (i < 0) return;
    open.splice(i, 1);
    if (i === 0) render();
  }

  // Typing in the field keeps its keys, and a shortcut is not a choice.
  el.addEventListener("keydown", (e) => {
    const target = e.target as Element;
    if (target.closest("textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!/^[1-9]$/.test(e.key)) return;
    e.preventDefault();
    area?.pick(Number(e.key) - 1);
  });

  return {
    show(frame) {
      const i = open.findIndex((f) => f.ask.ask_id === frame.ask.ask_id);
      if (i < 0) open.push(frame);
      else open[i] = frame;
      if (open[0] === frame) render();
    },
    end: close,
    clear() {
      open.length = 0;
      render();
    },
    dispose() {
      clearTimeout(tick);
      el.remove();
    },
  };
}
