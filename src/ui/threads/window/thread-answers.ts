/**
 * The thread pane's sends: each ask's draft, send error and in-flight send, kept outside the answer
 * area so a remount of it keeps them, and the answer area that shows now.
 */

import type { AskAnswer, Thread } from "../../../contract";
import type { AnswerArea } from "./answer-area";
import { type Draft, draftKey, pruneDrafts } from "./drafts";

export interface ThreadAnswers {
  /** What the answer area of `threadId`'s ask `askId` starts from. */
  of(threadId: string, askId: string): { draft: Draft; error: string | null; sending: boolean };
  setDraft(threadId: string, askId: string, draft: Draft): void;
  send(threadId: string, askId: string, answer: AskAnswer): void;
  /** Drops the drafts and errors of asks no longer open in `threads`. */
  prune(threads: Thread[]): void;
  /** Makes `area` the one the keys and the field focus reach; the returned call lets it go. */
  attach(area: AnswerArea): () => void;
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

  return {
    of(threadId, askId) {
      const key = draftKey(threadId, askId);
      return {
        draft: drafts.get(key) ?? { picks: [], text: "" },
        error: errors.get(key) ?? null,
        sending: sending.has(key),
      };
    },
    setDraft: (threadId, askId, draft) => drafts.set(draftKey(threadId, askId), draft),
    send(threadId, askId, answer) {
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
    },
    prune(threads) {
      pruneDrafts(drafts, threads);
      for (const key of errors.keys()) if (!drafts.has(key)) errors.delete(key);
    },
    attach(area) {
      shown = area;
      return () => {
        if (shown === area) shown = null;
      };
    },
    pick: (index) => shown?.pick(index),
    focusField() {
      const field = shown?.el.querySelector("textarea");
      if (!field) return false;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
      return true;
    },
  };
}
