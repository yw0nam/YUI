// @vitest-environment jsdom
/** wire-ask-card.test.ts — the Ask card driven by a push socket's ask frames and state. */

import { beforeEach, expect, it, vi } from "vitest";
import type { AnswerFrame, AskFrame } from "../../../io/chat/push/push-frames";
import type { PushSocketState } from "../../../io/chat/push/push-socket";
import { setLocale } from "../../../ui/i18n";
import { wireAskCard } from "./wire-ask-card";

const ask: AskFrame = {
  type: "ask",
  ask: {
    ask_id: "a1",
    prompt: "Run it?",
    choices: [
      { id: "once", label: "Allow Once" },
      { id: "deny", label: "Deny" },
    ],
    text: false,
  },
  expires_at: Date.now() + 60_000,
};

function build() {
  let onAsk: (frame: AskFrame) => void = () => {};
  let onState: (state: PushSocketState) => void = () => {};
  const sendAnswer = vi.fn((_frame: AnswerFrame) => true);
  const mount = document.createElement("div");
  document.body.append(mount);
  wireAskCard({
    socket: {
      onAsk: (cb) => ((onAsk = cb), () => {}),
      onAskEnd: () => () => {},
      onState: (cb) => ((onState = cb), () => {}),
      sendAnswer,
    },
    mount,
  });
  const card = () => mount.querySelector<HTMLElement>(".yui-ask-card")!;
  return {
    mount,
    card,
    sendAnswer,
    ask: (f: AskFrame) => onAsk(f),
    state: (s: PushSocketState) => onState(s),
  };
}

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
});

it("shows an ask frame in the mount", () => {
  const w = build();
  w.ask(ask);
  expect(w.card().hidden).toBe(false);
  expect(w.card().textContent).toContain("Run it?");
});

it("clears the card when the socket leaves ready", () => {
  const w = build();
  w.ask(ask);
  w.state({ kind: "disconnected" });
  expect(w.card().hidden).toBe(true);
});

it("sends the picked choice as an answer frame", () => {
  const w = build();
  w.ask(ask);
  w.card().querySelectorAll<HTMLButtonElement>(".yui-threads-answer__choices button")[0]!.click();
  w.card().querySelector<HTMLButtonElement>(".yui-threads-answer__send")!.click();
  expect(w.sendAnswer).toHaveBeenCalledWith({ type: "answer", ask_id: "a1", choice: "once" });
});
