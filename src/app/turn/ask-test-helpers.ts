/** A pet window's Ask card fed by the ask queue, the push session and Settings requests, driven as the user would. */

import { vi } from "vitest";
import type { AskAnswer, AskFrame } from "../../io/chat/push/push-frames";
import type { PushSocket } from "../../io/chat/push/push-socket";
import type { SettingsChange } from "../../settings/agent-access/document";
import { createAskCard } from "../../ui/ask/ask-card";
import { createAskQueue } from "./ask-queue";
import { wireAskSession } from "./push/ask-session";
import { createSettingsRequest, type SettingsAnswer } from "./settings-request";

export const SCREENSHOT: SettingsChange = {
  path: "privacy.screenshot",
  labelKey: "screenshot.label",
  from: false,
  to: true,
};

export function buildAskCard() {
  const mount = document.createElement("div");
  document.body.append(mount);
  const card = createAskCard({ mount });
  let answer!: (answer: AskAnswer) => boolean;
  const setAsks = vi.fn(card.set);
  const asks = createAskQueue({
    surfaces: {
      setAsks,
      onAskAnswer: (cb) => {
        answer = cb;
        card.onAnswer(cb);
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
  const el = mount.querySelector<HTMLElement>(".yui-ask-card")!;
  const choices = () => [...el.querySelectorAll<HTMLButtonElement>(".yui-answer__choices button")];
  return {
    el,
    asks,
    setAsks,
    sendAnswer,
    choices,
    /** The prompt's blocks as text, or null while the card is closed. */
    shown: () =>
      el.hidden
        ? null
        : [...el.querySelector(".yui-answer__prompt")!.children].map((b) => b.textContent),
    /** Picks the choice whose label ends with `label` and sends it. */
    choose: (label: string) => {
      choices()
        .find((b) => b.textContent?.endsWith(label))!
        .click();
      el.querySelector<HTMLButtonElement>(".yui-answer__send")!.click();
    },
    /** An Answer arriving from outside this card, as the popped message window sends one. */
    answer: (value: AskAnswer) => answer(value),
    request: (changes: SettingsChange[], signal = new AbortController().signal) => {
      const result: { value?: SettingsAnswer } = {};
      void request({ changes }, signal).then((value) => {
        result.value = value;
      });
      return result;
    },
    push: (frame: AskFrame) => ask(frame),
    end: (id: string) => end(id),
    dispose: () => {
      stop();
      asks.dispose();
      card.dispose();
    },
  };
}
