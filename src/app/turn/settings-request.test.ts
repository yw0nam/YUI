// @vitest-environment jsdom
/** settings-request.test.ts — a Settings request as the user meets it in the card, and what it resolves to. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BridgeTransport } from "../../io/bridge/core/bridge-core";
import { createMessageBridge } from "../../io/bridge/message/message-bridge";
import { createRemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { AskSlotAnswer, AskSlotFrame } from "../../io/chat/tools/run/settings-request-frame";
import type { SettingsChange } from "../../settings/agent-access/document";
import { setLocale } from "../../ui/i18n";
import { createSurfaces } from "../../ui/surfaces/surfaces";
import { noTool } from "../../ui/surfaces/test-helpers";
import { wireMessageSurfaceOps } from "../message/wire-message-surface-ops";
import { createAskQueue } from "./ask-queue";
import { buildAskCard, cardButton, SCREENSHOT, shownText } from "./ask-test-helpers";
import { createSettingsRequest, type SettingsDecision } from "./settings-request";

vi.mock("../../io/window/geometry/companion-column", () => ({
  focusWindow: vi.fn<typeof import("../../io/window/geometry/companion-column").focusWindow>(),
}));

const TITLE = "Rin wants to change settings";
const SHARED = "Applies to every character";
const REQUESTS: SettingsChange = {
  path: "privacy.screen_requests",
  labelKey: "screenshot.request_label",
  from: false,
  to: true,
};
const TIER2: SettingsChange = {
  path: "limits.tier2_max",
  labelKey: "reactions.rate_tier2_label",
  from: 3,
  to: 5,
};
const THREE = [SCREENSHOT, REQUESTS, TIER2];

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  setLocale("en");
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

it("shows one change with the why and the shared line, Deny in the neutral tone and Allow ready", () => {
  const w = buildAskCard();
  w.request([SCREENSHOT], undefined, "to see your code");
  expect(w.shown()).toEqual([TITLE, "Attach screenshot (off → on)", "“to see your code”", SHARED]);
  expect(w.button("Deny")?.matches("[class*=danger]")).toBe(false);
  expect(w.button("Allow")?.disabled).toBe(false);
  w.dispose();
});

it.each([
  ["Allow", { allow: ["privacy.screenshot"] }],
  ["Deny", { allow: [] }],
])("answers %s on one click with %j and closes the card", async (label, expected) => {
  const w = buildAskCard();
  const result = w.request([SCREENSHOT]);
  expect(w.shown()?.[0]).toBe(TITLE);
  w.click(label);
  await vi.waitFor(() => expect(result.value).toEqual(expected));
  expect(w.shown()).toBeNull();
  w.dispose();
});

it("shows three changes unchecked with Allow disabled, and Allow 2 writes the two checked in their order", async () => {
  const w = buildAskCard();
  const result = w.request(THREE);
  expect(w.shown()).toEqual([
    TITLE,
    "Attach screenshot (off → on)",
    "Allow screen requests (off → on)",
    "Times she speaks up per hour (3 → 5)",
    SHARED,
  ]);
  expect(w.button("Allow")?.disabled).toBe(true);
  w.check(2, 0);
  expect(w.button("Allow 2")?.disabled).toBe(false);
  w.click("Allow 2");
  await vi.waitFor(() =>
    expect(result.value).toEqual({ allow: ["privacy.screenshot", "limits.tier2_max"] }),
  );
  w.dispose();
});

it("opens a focused note with Add a note, and Deny carries the trimmed note", async () => {
  const w = buildAskCard();
  const result = w.request(THREE);
  w.note("  only the bubble  ");
  expect([document.activeElement === w.field(), w.button("Add a note")]).toEqual([true, undefined]);
  w.click("Deny");
  await vi.waitFor(() => expect(result.value).toEqual({ allow: [], note: "only the bubble" }));
  w.dispose();
});

it.each([
  [[0, 1], "Allow 2", ["privacy.screenshot", "privacy.screen_requests"]],
  [[], "Deny", []],
])("sends on Enter in the note with %j checked what the hint names, %s", async (checks, action, allow) => {
  const w = buildAskCard();
  const result = w.request(THREE);
  w.check(...checks);
  w.note("keep the wait at 10");
  expect(w.card()?.querySelector(".yui-settings-card__hint")?.textContent).toBe(
    `Enter sends ${action}, Shift+Enter starts a new line`,
  );
  w.enter();
  await vi.waitFor(() => expect(result.value).toEqual({ allow, note: "keep the wait at 10" }));
  w.dispose();
});

it.each([
  { isComposing: true },
  { keyCode: 229 },
  { shiftKey: true },
])("sends nothing on an Enter with %j", async (init) => {
  const w = buildAskCard();
  const result = w.request([SCREENSHOT]);
  w.note("only the bubble");
  w.enter(init);
  await Promise.resolve();
  expect([result.value, w.field()?.value]).toEqual([undefined, "only the bubble"]);
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

it("answers busy for a second request while one waits, with no second card, and shows a new card after the answer", async () => {
  const w = buildAskCard();
  const first = w.request([SCREENSHOT]);
  const second = w.request([SCREENSHOT]);

  await vi.waitFor(() => expect(second.value).toBe("busy"));
  expect(w.setAsks).toHaveBeenCalledOnce();

  w.click("Allow");
  await vi.waitFor(() => expect(first.value).toEqual({ allow: ["privacy.screenshot"] }));

  w.request([SCREENSHOT]);
  expect(w.shown()).not.toBeNull();
  w.dispose();
});

it("answers no answer for every request when the window's queue is disposed, and for one asked after", async () => {
  const w = buildAskCard();
  const abort = new AbortController();
  const shown = w.request([SCREENSHOT], abort.signal);
  // A different owner queued ahead, so the next Settings request really waits behind one.
  const ahead = { answer: () => true };
  w.asks.put(ahead, {
    type: "ask",
    ask: { ask_id: "ahead", prompt: "ahead", choices: [], text: false },
  });
  abort.abort();
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

/** A copy of `message-bridge.test.ts`'s transport that copies each payload as a webview event does. */
function createFakeTransport(): BridgeTransport {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    emit(name, payload) {
      for (const cb of [...(listeners.get(name) ?? [])]) cb(JSON.parse(JSON.stringify(payload)));
    },
    listen(name, cb) {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(cb);
      return () => set.delete(cb);
    },
  };
}

/** The pet window's queue and Settings request over the bridge to a real message window's surfaces. */
function popped() {
  const transport = createFakeTransport();
  const pet = createMessageBridge(transport, { windowKind: "pet" });
  const message = createMessageBridge(transport, { windowKind: "message" });
  const remote = createRemoteSurfaces(pet);
  const setAsks = vi.fn((frames: AskSlotFrame[]) => remote.setAsks(frames));
  const asks = createAskQueue({ surfaces: { setAsks, onAskAnswer: remote.onAskAnswer } });
  const request = createSettingsRequest({ asks, name: () => "Rin" });
  const surfaces = createSurfaces({ tool: noTool, mount: document.body });
  wireMessageSurfaceOps({ bridge: message, surfaces, name: { set: () => {} } });
  const result: { value?: SettingsDecision } = {};
  void request({ changes: [SCREENSHOT] }, new AbortController().signal).then((value) => {
    result.value = value;
  });
  const head = setAsks.mock.lastCall?.[0][0];
  return {
    root: surfaces.el,
    result,
    requestId: head?.type === "settings_request" ? head.request_id : undefined,
    /** A decision as the message window's control channel carries it, whatever its shape. */
    send: (answer: object) =>
      message.emitControl({ op: "ask-answer", answer: answer as AskSlotAnswer }),
    dispose: () => {
      asks.dispose();
      remote.dispose();
      surfaces.dispose();
    },
  };
}

it("resolves a request allowed on the popped message window's card", async () => {
  const p = popped();
  expect(shownText(p.root)).toEqual([TITLE, "Attach screenshot (off → on)", SHARED]);
  cardButton(p.root, "Allow")?.click();
  await vi.waitFor(() => expect(p.result.value).toEqual({ allow: ["privacy.screenshot"] }));
  expect(shownText(p.root)).toBeNull();
  p.dispose();
});

it.each([
  [{ allow: null }],
  [{ allow: ["privacy.screenshot"], note: 42 }],
])("takes no decision shaped %j from the message window and keeps the card", async (bad) => {
  const p = popped();
  expect(shownText(p.root)).toEqual([TITLE, "Attach screenshot (off → on)", SHARED]);
  p.send({ request_id: p.requestId, ...bad });
  await Promise.resolve();
  expect([p.result.value, shownText(p.root)?.[0]]).toEqual([undefined, TITLE]);
  p.dispose();
});
