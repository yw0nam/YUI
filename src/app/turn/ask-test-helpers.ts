/** A pet window's Ask slot fed by the ask queue, the push session and Settings requests, driven as the user would. */

import { vi } from "vitest";
import type { AskFrame } from "../../io/chat/push/push-frames";
import type { PushSocket } from "../../io/chat/push/push-socket";
import type { AskSlotAnswer } from "../../io/chat/tools/run/settings-request-frame";
import type { SettingsChange } from "../../settings/agent-access/document";
import { createSlotCards } from "../../ui/ask/slot-cards";
import { createAskQueue } from "./ask-queue";
import { wireAskSession } from "./push/ask-session";
import { createSettingsRequest, type SettingsDecision } from "./settings-request";

export const SCREENSHOT: SettingsChange = {
  path: "privacy.screenshot",
  labelKey: "screenshot.label",
  from: false,
  to: true,
};

/** The shown card in `root`'s slot. */
export const shownCard = (root: ParentNode) =>
  root.querySelector<HTMLElement>(".yui-ask-card:not([hidden])");

/** The shown card's text: an Ask's prompt blocks, or a Settings request's title and lines; null while none shows. */
export function shownText(root: ParentNode): string[] | null {
  const el = shownCard(root);
  if (!el) return null;
  const prompt = el.querySelector(".yui-answer__prompt");
  const blocks = prompt
    ? [...prompt.children]
    : [...el.querySelectorAll(".yui-settings-card__title, .yui-settings-card__body :is(p, label)")];
  return blocks.map((b) => b.textContent ?? "");
}

/** The shown card's visible button labelled `label`. */
export const cardButton = (root: ParentNode, label: string) =>
  [...(shownCard(root)?.querySelectorAll<HTMLButtonElement>("button:not([hidden])") ?? [])].find(
    (b) => b.textContent === label,
  );

export function buildAskCard() {
  const mount = document.createElement("div");
  document.body.append(mount);
  const cards = createSlotCards({ mount });
  let answer!: (answer: AskSlotAnswer) => boolean;
  const setAsks = vi.fn(cards.set);
  const asks = createAskQueue({
    surfaces: {
      setAsks,
      onAskAnswer: (cb) => {
        answer = cb;
        cards.onAnswer(cb);
      },
    },
  });
  const request = createSettingsRequest({ asks, name: () => "Rin" });
  let ask!: Parameters<PushSocket["onAsk"]>[0];
  let end!: Parameters<PushSocket["onAskEnd"]>[0];
  const sendAnswer = vi.fn(() => true);
  const stop = wireAskSession({
    socket: {
      onAsk: (cb) => {
        ask = cb;
        return () => {};
      },
      onAskEnd: (cb) => {
        end = cb;
        return () => {};
      },
      onState: () => () => {},
      sendAnswer,
    },
    asks,
  });
  const card = () => shownCard(mount);
  const choices = () => [
    ...(card()?.querySelectorAll<HTMLButtonElement>(".yui-answer__choices button") ?? []),
  ];
  const button = (label: string) => cardButton(mount, label);
  const field = () => card()?.querySelector<HTMLTextAreaElement>("textarea");
  return {
    card,
    asks,
    setAsks,
    sendAnswer,
    choices,
    button,
    field,
    shown: () => shownText(mount),
    /** On the Ask card: picks the choice whose label ends with `label` and sends it. */
    choose: (label: string) => {
      choices()
        .find((b) => b.textContent?.endsWith(label))
        ?.click();
      card()?.querySelector<HTMLButtonElement>(".yui-answer__send")?.click();
    },
    /** Clicks the shown card's button labelled `label`. */
    click: (label: string) => button(label)?.click(),
    /** Ticks the Settings request's checkboxes at these indexes. */
    check: (...indexes: number[]) => {
      const boxes = [...(card()?.querySelectorAll<HTMLInputElement>("[type=checkbox]") ?? [])];
      for (const i of indexes) boxes[i]?.click();
    },
    /** Opens the note with "Add a note" and types `text` into it. */
    note: (text: string) => {
      button("Add a note")?.click();
      const el = field();
      if (!el) return;
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    /** Presses Enter in the note field. */
    enter: (init: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...init,
      });
      // jsdom drops keyCode from the init.
      if (init.keyCode !== undefined) Object.defineProperty(e, "keyCode", { value: init.keyCode });
      field()?.dispatchEvent(e);
    },
    /** An Answer or decision arriving from outside this card, as the popped message window sends one. */
    answer: (value: AskSlotAnswer) => answer(value),
    request: (changes: SettingsChange[], signal = new AbortController().signal, why?: string) => {
      const result: { value?: SettingsDecision } = {};
      void request({ changes, why }, signal).then((value) => {
        result.value = value;
      });
      return result;
    },
    push: (frame: AskFrame) => ask(frame),
    end: (id: string) => end(id),
    dispose: () => {
      stop();
      asks.dispose();
      cards.dispose();
    },
  };
}
