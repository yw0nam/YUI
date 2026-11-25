/**
 * The thread pane's sends: each ask's draft, send error and in-flight send, kept outside the answer
 * area so a remount of it keeps them, and the answer area that shows now.
 */

import type { AskAnswer, Thread, ThreadAsk } from "../../../contract";
import { type AnswerArea, createAnswerArea, type Draft } from "../../ask/answer-area";
import { draftKey, pruneDrafts } from "./drafts";

/** What an ask's answer area starts from. */
export interface AnswerStart {
  draft: Draft;
  error: string | null;
  sending: boolean;
}

export interface ThreadAnswers {
  /** What the answer area of `threadId`'s ask `askId` starts from. */
  of(threadId: string, askId: string): AnswerStart;
  /** Draws `threadId`'s `ask` from `start` into `host`, keeping a focused field focused; the returned call lets it go. */
  mount(host: HTMLElement, threadId: string, ask: ThreadAsk, start: AnswerStart): () => void;
  /** Drops the drafts and errors of asks no longer open in `threads`. */
  prune(threads: Thread[]): void;
  /** Toggles the shown ask's choice at `index`. */
  pick(index: number): void;
  /** Focuses the shown answer field with the caret at its end; false when there is none. */
  focusField(): boolean;
}

export function createThreadAnswers(deps: {
  /** Rejects with the store's error string. */
  onAnswer(id: string, askId: string, answer: AskAnswer): Promise<void>;
  /** An error or an in-flight send changed. */
  changed(): void;
}): ThreadAnswers {
  const drafts = new Map<string, Draft>();
  const errors = new Map<string, string>();
  // Kept outside the answer area, so a remount mid-send never enables a second send.
  const sending = new Set<string>();
  let shown: AnswerArea | null = null;

  function send(threadId: string, askId: string, answer: AskAnswer): void {
    const key = draftKey(threadId, askId);
    errors.delete(key);
    sending.add(key);
    deps.changed();
    // The ask id is the one this send answers, so a late result never touches a newer ask.
    deps.onAnswer(threadId, askId, answer).then(
      () => {
        sending.delete(key);
        drafts.delete(key);
        deps.changed();
      },
      (error) => {
        sending.delete(key);
        errors.set(key, String(error));
        deps.changed();
      },
    );
  }

  function focusField(): boolean {
    const field = shown?.el.querySelector("textarea");
    if (!field) return false;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    return true;
  }

  return {
    of(threadId, askId) {
      const key = draftKey(threadId, askId);
      return {
        draft: drafts.get(key) ?? { picks: [], text: "" },
        error: errors.get(key) ?? null,
        sending: sending.has(key),
      };
    },
    mount(host, threadId, ask, start) {
      const active = document.activeElement;
      const hadField = active?.tagName === "TEXTAREA" && host.contains(active);
      const area = createAnswerArea({
        ask,
        ...start,
        onDraft: (draft) => drafts.set(draftKey(threadId, ask.ask_id), draft),
        onSend: (answer) => send(threadId, ask.ask_id, answer),
      });
      host.replaceChildren(area.el);
      shown = area;
      if (hadField) focusField();
      return () => {
        if (shown === area) shown = null;
      };
    },
    prune(threads) {
      pruneDrafts(drafts, threads);
      for (const key of errors.keys()) if (!drafts.has(key)) errors.delete(key);
    },
    pick: (index) => shown?.pick(index),
    focusField,
  };
}
