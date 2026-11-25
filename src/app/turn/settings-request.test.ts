// @vitest-environment jsdom
/** settings-request.test.ts — a Settings request as the user meets it in the card, and what it resolves to. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MessageBridge, MessageControlOp } from "../../io/bridge/message/message-bridge";
import { createRemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { AskFrame } from "../../io/chat/push/push-frames";
import { setLocale } from "../../ui/i18n";
import { createAskQueue } from "./ask-queue";
import { buildAskCard, SCREENSHOT } from "./ask-test-helpers";
import { createSettingsRequest, type SettingsAnswer } from "./settings-request";

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  setLocale("en");
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

it("shows the change with Deny in the danger tone and Allow in the primary tone", () => {
  const w = buildAskCard();
  w.request([SCREENSHOT]);
  expect(w.shown()).toEqual([
    "Rin wants to change settings",
    "Attach screenshot (off → on)\nApplies to every character",
  ]);
  const [frame] = w.setAsks.mock.lastCall![0];
  expect(frame!.ask.choices).toEqual([
    { id: "deny", label: "Deny", tone: "danger" },
    { id: "allow", label: "Allow", tone: "primary" },
  ]);
  w.dispose();
});

it.each([
  ["Allow", "allow"],
  ["Deny", "deny"],
])("answers %s with %s and closes the card", async (label, expected) => {
  const w = buildAskCard();
  const result = w.request([SCREENSHOT]);
  expect(w.shown()).not.toBeNull();
  w.choose(label);
  await vi.waitFor(() => expect(result.value).toBe(expected));
  expect(w.shown()).toBeNull();
  w.dispose();
});

it.each(["expiry", "abort"])("answers no answer on %s and closes the card", async (event) => {
  const w = buildAskCard();
  const abort = new AbortController();
  const result = w.request([SCREENSHOT], abort.signal);
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

it("answers no answer for every request when the window's queue is disposed, and for one asked after", async () => {
  const w = buildAskCard();
  const shown = w.request([SCREENSHOT]);
  const queued = w.request([SCREENSHOT]);
  expect(w.shown()).not.toBeNull();
  w.asks.dispose();
  const late = w.request([SCREENSHOT]);
  await vi.waitFor(() =>
    expect([shown.value, queued.value, late.value]).toEqual([
      "no answer",
      "no answer",
      "no answer",
    ]),
  );
  expect(w.setAsks).toHaveBeenLastCalledWith([]);
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
