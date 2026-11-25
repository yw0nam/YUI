// @vitest-environment jsdom
/** ask-queue.test.ts — one Ask card slot shared by the push socket's Asks and Settings requests. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MessageBridge, MessageControlOp } from "../../io/bridge/message/message-bridge";
import { createRemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { AskFrame } from "../../io/chat/push/push-frames";
import type { PushSocket } from "../../io/chat/push/push-socket";
import type { SettingsChange } from "../../settings/agent-access/document";
import { createAskCard } from "../../ui/ask/ask-card";
import { setLocale } from "../../ui/i18n";
import { createAskQueue } from "./ask-queue";
import { wireAskSession } from "./push/ask-session";
import { createSettingsRequest, type SettingsAnswer } from "./settings-request";

const SCREENSHOT: SettingsChange = {
  path: "privacy.screenshot",
  labelKey: "screenshot.label",
  from: false,
  to: true,
};
const TIER2: SettingsChange = {
  path: "limits.tier2_max",
  labelKey: "reactions.rate_tier2_label",
  from: 3,
  to: 5,
};

const pushAsk: AskFrame = {
  type: "ask",
  ask: {
    ask_id: "p1",
    prompt: "Run `uptime`?",
    choices: [{ id: "once", label: "Allow Once" }],
    text: false,
  },
};

function build() {
  const mount = document.createElement("div");
  document.body.append(mount);
  const card = createAskCard({ mount });
  const asks = createAskQueue({ surfaces: { setAsks: card.set, onAskAnswer: card.onAnswer } });
  const request = createSettingsRequest({ asks, name: () => "Rin" });
  let ask!: Parameters<PushSocket["onAsk"]>[0];
  const sendAnswer = vi.fn(() => true);
  const stop = wireAskSession({
    socket: {
      onAsk: (cb) => {
        ask = cb;
        return () => {};
      },
      onAskEnd: () => () => {},
      onState: () => () => {},
      sendAnswer,
    },
    asks,
  });
  const el = mount.querySelector<HTMLElement>(".yui-ask-card")!;
  const shown = () => (el.hidden ? null : el.querySelector(".yui-answer__prompt")!.textContent);
  const choose = (label: string) => {
    const choices = [...el.querySelectorAll<HTMLButtonElement>(".yui-answer__choices button")];
    choices.find((b) => b.textContent?.endsWith(label))!.click();
    el.querySelector<HTMLButtonElement>(".yui-answer__send")!.click();
  };
  const ask$ = (changes: SettingsChange[], why?: string, signal = new AbortController().signal) => {
    const result: { value?: SettingsAnswer } = {};
    void request({ changes, ...(why === undefined ? {} : { why }) }, signal).then((value) => {
      result.value = value;
    });
    return result;
  };
  return {
    el,
    shown,
    choose,
    ask$,
    push: (frame: AskFrame) => ask(frame),
    sendAnswer,
    dispose: () => {
      stop();
      asks.dispose();
      card.dispose();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  setLocale("en");
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

it("shows a request as a card with Deny and Allow and one line per change", () => {
  const w = build();
  w.ask$([SCREENSHOT, TIER2]);
  expect(w.shown()?.split("\n")).toEqual([
    "Rin wants to change a setting",
    "Attach screenshot: off → on",
    "Times she speaks up per hour: 3 → 5",
    "Applies to every character",
  ]);
  const choices = [...w.el.querySelectorAll<HTMLButtonElement>(".yui-answer__choices button")];
  expect(choices.map((b) => [b.textContent, b.classList.contains("is-danger")])).toEqual([
    ["1Deny", true],
    ["2Allow", false],
  ]);
  w.dispose();
});

it.each([
  ["Allow", "allow"],
  ["Deny", "deny"],
])("answers %s with %s and closes the card", async (label, expected) => {
  const w = build();
  const result = w.ask$([SCREENSHOT]);
  expect(w.shown()).not.toBeNull();
  w.choose(label);
  await vi.waitFor(() => expect(result.value).toBe(expected));
  expect(w.shown()).toBeNull();
  w.dispose();
});

it.each(["expiry", "abort"])("answers no answer on %s and closes the card", async (event) => {
  const w = build();
  const abort = new AbortController();
  const result = w.ask$([SCREENSHOT], undefined, abort.signal);
  expect(w.shown()).not.toBeNull();
  if (event === "abort") abort.abort();
  else {
    vi.advanceTimersByTime(59_999);
    expect(w.shown()).not.toBeNull();
    vi.advanceTimersByTime(1);
  }
  await vi.waitFor(() => expect(result.value).toBe("no answer"));
  expect(w.shown()).toBeNull();
  w.dispose();
});

it("holds a request behind a shown push Ask and starts its 60 s when it shows", async () => {
  const w = build();
  w.push(pushAsk);
  const result = w.ask$([SCREENSHOT]);
  expect(w.shown()).toBe("Run uptime?");
  vi.advanceTimersByTime(90_000);
  w.choose("Allow Once");
  expect(w.shown()?.split("\n")[0]).toBe("Rin wants to change a setting");
  vi.advanceTimersByTime(59_999);
  expect(result.value).toBeUndefined();
  vi.advanceTimersByTime(1);
  await vi.waitFor(() => expect(result.value).toBe("no answer"));
  w.dispose();
});

it("holds a push Ask behind a shown request, and its Answer then reaches the socket", async () => {
  const w = build();
  const result = w.ask$([SCREENSHOT]);
  w.push(pushAsk);
  expect(w.shown()?.split("\n")[0]).toBe("Rin wants to change a setting");
  w.choose("Allow");
  await vi.waitFor(() => expect(result.value).toBe("allow"));
  expect(w.shown()).toBe("Run uptime?");
  w.choose("Allow Once");
  expect(w.sendAnswer).toHaveBeenCalledExactlyOnceWith({
    type: "answer",
    ask_id: "p1",
    choice: "once",
  });
  expect(w.shown()).toBeNull();
  w.dispose();
});

it("resolves a request answered in the popped message window", async () => {
  let control!: (op: MessageControlOp) => void;
  const bridge = {
    emitSurface: vi.fn(),
    onControl: (cb: typeof control) => {
      control = cb;
      return () => {};
    },
  } as unknown as MessageBridge;
  const remote = createRemoteSurfaces(bridge);
  const asks = createAskQueue({ surfaces: remote });
  const request = createSettingsRequest({ asks, name: () => "Rin" });
  let value: SettingsAnswer | undefined;
  void request({ changes: [SCREENSHOT] }, new AbortController().signal).then((v) => {
    value = v;
  });
  const sent = vi.mocked(bridge.emitSurface).mock.calls.at(-1)?.[0] as
    | { op: "asks"; frames: AskFrame[] }
    | undefined;
  expect(sent?.frames.map((f) => f.ask.choices.map((c) => c.id))).toEqual([["deny", "allow"]]);
  control({ op: "ask-answer", answer: { ask_id: sent!.frames[0]!.ask.ask_id, choice: "allow" } });
  await vi.waitFor(() => expect(value).toBe("allow"));
  expect(bridge.emitSurface).toHaveBeenLastCalledWith({ op: "asks", frames: [] });
  asks.dispose();
  remote.dispose();
});

it.each([
  [
    "a newline and an image",
    "first\nsecond ![x](https://e/x.png)",
    "“first second ![x](https://e/x.png)”",
  ],
  ["300 characters", "a".repeat(300), `“${"a".repeat(200)}”`],
])("prints a why with %s as one plain line", (_case, why, line) => {
  const w = build();
  w.ask$([SCREENSHOT], why);
  expect(w.shown()?.split("\n")).toEqual([
    "Rin wants to change a setting",
    "Attach screenshot: off → on",
    line,
    "Applies to every character",
  ]);
  expect(w.el.querySelector("img")).toBeNull();
  w.dispose();
});
