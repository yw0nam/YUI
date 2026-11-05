// @vitest-environment jsdom
/**
 * settings-bridge.test.ts — cross-window settings bridge.
 *
 * Pins the contract for src/io/bridge/settings-bridge.ts:
 *   createSettingsBridge(transport, { windowKind }) builds a typed bus over an injectable transport.
 *   Two bridge instances sharing one fake transport simulate two Tauri windows —
 *   an emit on A delivers to the matching on* callback on B.
 *   Disposers (per-listener and dispose()) stop delivery.
 *
 * The default transport selection (Tauri dynamic import / BroadcastChannel / no-op)
 * is integration and intentionally not unit-tested here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeTransport } from "./core/bridge-core";
import type { MessageSurfaceOp } from "./message/surface-ops";
import { type channels, createSettingsBridge, type SettingsBridge } from "./settings-bridge";

// In-memory pub/sub transport shared by two bridges (= two windows).
function createFakeTransport(): BridgeTransport & {
  listeners: Map<string, Set<(p: unknown) => void>>;
} {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    listeners,
    emit(name, payload) {
      const set = listeners.get(name);
      if (!set) return;
      for (const cb of [...set]) cb(payload);
    },
    listen(name, cb) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(cb);
      return () => set!.delete(cb);
    },
  };
}

interface Row {
  name: string;
  args: unknown[];
  /** The payload the envelope carries. */
  wire: unknown;
  /** The arguments the receiving callback gets. */
  delivered: unknown[];
  scope: "shared" | "preset";
  settled?: true;
}

const none = { args: [], wire: undefined, delivered: [] };
const same = (value: unknown) => ({ args: [value], wire: value, delivered: [value] });

const rows: Record<keyof typeof channels, Row> = {
  SpeechStream: {
    name: "yui://speech-stream",
    scope: "shared",
    ...same({ preset: "a", op: { op: "push", delta: "hi" } }),
  },
  SpeechStreamAsk: { name: "yui://speech-stream-ask", scope: "shared", ...none },
  StopTurns: { name: "yui://stop-turns", scope: "shared", ...none },
  SpeechOnset: { name: "yui://speech-onset", scope: "shared", ...none },
  SpeechStreamControl: {
    name: "yui://speech-stream-control",
    scope: "shared",
    ...same({ preset: "a", op: { op: "input-error-action" } }),
  },
  SettingsPage: {
    name: "yui://settings-page",
    scope: "shared",
    ...same({ preset: "a", page: "conn" }),
  },
  OpenDevtools: { name: "yui://open-devtools", scope: "shared", ...none },
  QuickCardOpen: {
    name: "yui://quick-card-open",
    scope: "preset",
    ...same({ left: 1, right: 200, y: 30 }),
  },
  QuickCardReady: { name: "yui://quick-card-ready", scope: "preset", ...none },
  ThreadsOpen: { name: "yui://threads-open", scope: "shared", ...same({ tab: "terminal" }) },
  ThreadsReady: { name: "yui://threads-ready", scope: "shared", ...none },
  ThreadsClosed: { name: "yui://threads-closed", scope: "shared", ...none },
  ThreadsOpenRequest: {
    name: "yui://threads-open-request",
    scope: "shared",
    args: ["terminal"],
    wire: { tab: "terminal" },
    delivered: ["terminal"],
  },
  SettingsChanged: {
    name: "yui://settings-changed",
    scope: "shared",
    ...none,
    delivered: ["pet"],
  },
  MouthPreview: { name: "yui://mouth-preview", scope: "preset", ...same(0.3) },
  VoiceSet: { name: "yui://voice-set", scope: "shared", ...same(true) },
  VoiceState: { name: "yui://voice-state", scope: "shared", ...same({ state: "listening" }) },
  PushState: { name: "yui://push-state", scope: "preset", ...same({ kind: "disconnected" }) },
  PushStateAsk: { name: "yui://push-state-ask", scope: "preset", ...none },
  PushReset: { name: "yui://push-reset", scope: "preset", ...none },
  SessionReset: { name: "yui://session-reset", scope: "preset", ...same("a") },
  FirstConversationConnected: {
    name: "yui://first-conversation-connected",
    scope: "preset",
    ...none,
  },
  FirstConversationReplay: { name: "yui://first-conversation-replay", scope: "preset", ...none },
  PushReconnect: { name: "yui://push-reconnect", scope: "preset", ...none },
  Delegations: {
    name: "yui://delegations",
    scope: "preset",
    ...same([{ id: "d1", title: "build", started_at: 1, state: "running" }]),
  },
  DelegationsAsk: { name: "yui://delegations-ask", scope: "preset", ...none },
  Reasoning: { name: "yui://reasoning", scope: "preset", ...same({ text: "x", live: true }) },
  ReasoningAsk: { name: "yui://reasoning-ask", scope: "preset", ...none },
  HelpGuide: {
    name: "yui://help-guide",
    scope: "preset",
    ...same({ guide: "controls", text: "help" }),
  },
  PresetChanged: {
    name: "yui://preset-changed",
    scope: "shared",
    settled: true,
    ...same({ active: "b" }),
  },
  PetWindowsChanged: {
    name: "yui://pet-windows-changed",
    scope: "shared",
    settled: true,
    ...none,
  },
  CharacterAddressed: {
    name: "yui://character-addressed",
    scope: "shared",
    ...same({ from: "p1", name: "Perlica", to: "p2", text: "x", ts: 1 }),
  },
  UserTurnRouted: {
    name: "yui://user-turn-routed",
    scope: "shared",
    ...same({ sendId: "s1", to: "p2", text: "x" }),
  },
  VoiceSegment: { name: "yui://voice-segment", scope: "shared", ...same({ text: "hello" }) },
  UserTurnDone: {
    name: "yui://user-turn-done",
    scope: "shared",
    ...same({ sendId: "s1", preset: "p2" }),
  },
};

type Method = (...args: unknown[]) => unknown;
const call = (bridge: SettingsBridge, method: string, ...args: unknown[]): unknown =>
  (bridge as unknown as Record<string, Method>)[method]!(...args);

describe("every channel", () => {
  afterEach(() => history.replaceState(null, "", "/"));

  function windows() {
    const t = createFakeTransport();
    const sent = vi.spyOn(t, "emit");
    const open = (windowKind: "pet" | "settings", preset: string) => {
      history.replaceState(null, "", `/?preset=${preset}`);
      return createSettingsBridge(t, { windowKind });
    };
    return {
      t,
      sent,
      sender: open("pet", "a"),
      samePreset: open("settings", "a"),
      otherPreset: open("settings", "b"),
    };
  }

  it.each(Object.entries(rows))("round-trips %s through two windows", async (key, row) => {
    const { t, sent, sender, samePreset, otherPreset } = windows();
    const [self, a, b] = [sender, samePreset, otherPreset].map((bridge) => {
      const cb = vi.fn();
      call(bridge, `on${key}`, cb);
      return cb;
    });

    const returned = call(sender, `emit${key}`, ...row.args);

    if (row.settled) await expect(returned).resolves.toBeUndefined();
    else expect(returned).toBeUndefined();
    expect(
      sent.mock.calls.map(([name, env]) => [name, (env as { payload: unknown }).payload]),
    ).toStrictEqual([[row.name, row.wire]]);
    expect(self).not.toHaveBeenCalled();
    expect(a!.mock.calls).toStrictEqual([row.delivered]);
    expect(b!.mock.calls).toStrictEqual(row.scope === "shared" ? [row.delivered] : []);

    // An envelope without a preset reaches only the shared channels.
    t.emit(row.name, { __src: "other", __kind: "pet", payload: row.wire });
    expect(a!.mock.calls).toStrictEqual(
      row.scope === "shared" ? [row.delivered, row.delivered] : [row.delivered],
    );
  });

  it.each([
    ["MouthPreview", undefined, [[null]]],
    ["VoiceSet", undefined, [[false]]],
    ["Delegations", "garbage", [[[]]]],
    ["Reasoning", null, []],
  ] as const)("normalizes a raw %s payload %j", (key, payload, calls) => {
    const { t, samePreset } = windows();
    const cb = vi.fn();
    call(samePreset, `on${key}`, cb);

    t.emit(rows[key].name, { __src: "other", __kind: "pet", __preset: "a", payload });

    expect(cb.mock.calls).toStrictEqual(calls);
  });
});

describe("createSettingsBridge", () => {
  it("ignores a message that carries no envelope", () => {
    const t = createFakeTransport();
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const changed = vi.fn();
    const mouth = vi.fn();
    b.onSettingsChanged(changed);
    b.onMouthPreview(mouth);

    t.emit("yui://settings-changed", undefined);
    t.emit("yui://mouth-preview", 0.25);

    expect(changed).not.toHaveBeenCalled();
    expect(mouth).not.toHaveBeenCalled();
  });

  it("per-listener disposer stops delivery", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const cb = vi.fn();
    const off = b.onMouthPreview(cb);

    a.emitMouthPreview(0.5);
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    a.emitMouthPreview(0.7);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("dispose() removes all listeners created via the bridge", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const mouth = vi.fn();
    const voice = vi.fn();
    b.onMouthPreview(mouth);
    b.onVoiceSet(voice);

    b.dispose();

    a.emitMouthPreview(0.5);
    a.emitVoiceSet(true);
    expect(mouth).not.toHaveBeenCalled();
    expect(voice).not.toHaveBeenCalled();
  });

  it("ignores self-emitted events but delivers them to a second instance", () => {
    // Shared transport broadcasts to every registered listener (incl. the emitter's own) —
    // models Tauri global emit delivering back to the sender window.
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const selfCb = vi.fn();
    const otherCb = vi.fn();
    a.onSettingsChanged(selfCb);
    b.onSettingsChanged(otherCb);

    a.emitSettingsChanged();
    expect(selfCb).not.toHaveBeenCalled();
    expect(otherCb).toHaveBeenCalledTimes(1);

    // Payload-bearing channels: the second instance still receives the unwrapped value.
    const selfMouth = vi.fn();
    const otherMouth = vi.fn();
    a.onMouthPreview(selfMouth);
    b.onMouthPreview(otherMouth);
    a.emitMouthPreview(0.42);
    expect(selfMouth).not.toHaveBeenCalled();
    expect(otherMouth).toHaveBeenCalledWith(0.42);
  });

  it("does not throw when the transport.emit throws", () => {
    const throwing: BridgeTransport = {
      emit() {
        throw new Error("transport down");
      },
      listen() {
        return () => {};
      },
    };
    const bridge = createSettingsBridge(throwing, { windowKind: "pet" });
    expect(() => bridge.emitMouthPreview(0.1)).not.toThrow();
    expect(() => bridge.emitSettingsChanged()).not.toThrow();
  });

  it("ignores a reasoning payload whose text is not a string", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "message" });
    const cb = vi.fn();
    b.onReasoning(cb);

    a.emitReasoning({ text: 5, live: true } as never);

    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores a reasoning payload whose live is not a boolean", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "message" });
    const cb = vi.fn();
    b.onReasoning(cb);

    a.emitReasoning({ text: "x", live: "yes" } as never);

    expect(cb).not.toHaveBeenCalled();
  });

  it("delivers a quick-card open request from A to B, with and without the listening flag", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "quick-card" });
    const cb = vi.fn();
    b.onQuickCardOpen(cb);

    a.emitQuickCardOpen({ left: 64, right: 336, y: 120 });
    a.emitQuickCardOpen({ left: 64, right: 336, y: 120, listening: true });

    expect(cb.mock.calls).toEqual([
      [{ left: 64, right: 336, y: 120 }],
      [{ left: 64, right: 336, y: 120, listening: true }],
    ]);
  });

  it.each([
    [{ left: Number.NaN, right: 200, y: 30 }],
    [{ left: 64, right: Number.POSITIVE_INFINITY, y: 30 }],
    [{ left: 64, right: 200, y: Number.NaN }],
    [{ left: "64", right: 200, y: 30 }],
    [{ left: 64, right: 200, y: 30, listening: "yes" }],
  ])("ignores a quick-card open request %j with a field outside the contract", (payload) => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "quick-card" });
    const cb = vi.fn();
    b.onQuickCardOpen(cb);

    a.emitQuickCardOpen(payload as never);

    expect(cb).not.toHaveBeenCalled();
  });

  it("delivers a Threads open request with a chip rect, a tab, or both", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "threads" });
    const cb = vi.fn();
    b.onThreadsOpen(cb);
    const chip = { x: 10, y: 20, width: 100, height: 30 };

    a.emitThreadsOpen({ chip });
    a.emitThreadsOpen({ tab: "terminal" });
    a.emitThreadsOpen({ chip, tab: "threads" });

    expect(cb.mock.calls).toEqual([[{ chip }], [{ tab: "terminal" }], [{ chip, tab: "threads" }]]);
  });

  it.each([
    [{ chip: { x: Number.NaN, y: 0, width: 1, height: 1 } }],
    [{ chip: { x: 0, y: 0, width: "1", height: 1 } }],
    [{ chip: null, tab: "terminal" }],
    [{ tab: "shell" }],
  ])("ignores a Threads open request %j with a field outside the contract", (payload) => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "threads" });
    const cb = vi.fn();
    b.onThreadsOpen(cb);

    a.emitThreadsOpen(payload as never);

    expect(cb).not.toHaveBeenCalled();
  });

  it("delivers a quick card's request to open the Threads window on a tab, and ignores another tab", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "quick-card" });
    const b = createSettingsBridge(t, { windowKind: "pet" });
    const cb = vi.fn();
    b.onThreadsOpenRequest(cb);

    a.emitThreadsOpenRequest("terminal");
    a.emitThreadsOpenRequest("threads");
    a.emitThreadsOpenRequest("shell" as never);

    expect(cb.mock.calls).toEqual([["terminal"], ["threads"]]);
  });

  it.each([
    [null],
    [{}],
    [{ active: 7 }],
    [{ active: "" }],
  ])("ignores a preset-changed payload %j without an active id", (payload) => {
    const t = createFakeTransport();
    const b = createSettingsBridge(t, { windowKind: "pet" });
    const cb = vi.fn();
    b.onPresetChanged(cb);

    t.emit("yui://preset-changed", { __src: "other", __kind: "settings", payload });

    expect(cb).not.toHaveBeenCalled();
  });

  it("stops reasoning delivery on the per-listener disposer and on dispose()", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "message" });
    const cb = vi.fn();
    const ask = vi.fn();
    const off = b.onReasoning(cb);
    b.onReasoningAsk(ask);

    off();
    a.emitReasoning({ text: "late", live: false });
    expect(cb).not.toHaveBeenCalled();

    b.dispose();
    b.emitReasoningAsk();
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, {}],
    ["  user\nmessage  ", { user_message: "  user\nmessage  " }],
    [42, {}],
  ])("delivers a character-addressed event with user_message=%j", (userMessage, extra) => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "pet" });
    const cb = vi.fn();
    b.onCharacterAddressed(cb);

    a.emitCharacterAddressed({
      from: "perlica",
      name: "Perlica",
      to: "natsume",
      text: "natsume, you took my chair",
      ts: 1_717_000_000_000,
      user_message: userMessage,
    } as never);

    expect(cb).toHaveBeenCalledWith({
      from: "perlica",
      name: "Perlica",
      to: "natsume",
      text: "natsume, you took my chair",
      ts: 1_717_000_000_000,
      ...extra,
    });
  });

  it.each([
    { from: "perlica", name: "Perlica", to: "natsume", ts: 1 },
    { from: "perlica", name: "Perlica", to: 7, text: "x", ts: 1 },
    "garbage",
  ])("ignores a malformed character-addressed payload %j", (payload) => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "pet" });
    const cb = vi.fn();
    b.onCharacterAddressed(cb);

    a.emitCharacterAddressed(payload as never);

    expect(cb).not.toHaveBeenCalled();
  });

  it("delivers a routed user turn from the unified window to a pet window", () => {
    const t = createFakeTransport();
    const unified = createSettingsBridge(t, { windowKind: "unified" });
    const pet = createSettingsBridge(t, { windowKind: "pet" });
    const cb = vi.fn();
    pet.onUserTurnRouted(cb);

    unified.emitUserTurnRouted({
      sendId: "s1",
      to: "natsume",
      text: "@Natsume hi",
      mention: "character",
    });
    unified.emitUserTurnRouted({ sendId: "s2", to: "natsume", text: "hi" });
    unified.emitUserTurnRouted({ sendId: "s3", to: "natsume", text: "hey", via: "voice" });

    expect(cb.mock.calls).toEqual([
      [{ sendId: "s1", to: "natsume", text: "@Natsume hi", mention: "character" }],
      [{ sendId: "s2", to: "natsume", text: "hi" }],
      [{ sendId: "s3", to: "natsume", text: "hey", via: "voice" }],
    ]);
  });

  it("delivers main's voice segment to the unified window and drops one with no text", () => {
    const t = createFakeTransport();
    const main = createSettingsBridge(t, { windowKind: "pet" });
    const unified = createSettingsBridge(t, { windowKind: "unified" });
    const cb = vi.fn();
    unified.onVoiceSegment(cb);

    main.emitVoiceSegment({ text: "hello there" });
    main.emitVoiceSegment({ text: "" });
    main.emitVoiceSegment({ text: 7 } as never);

    expect(cb.mock.calls).toEqual([[{ text: "hello there" }]]);
  });

  it.each([
    { sendId: "s1", to: "natsume" },
    { sendId: 7, to: "natsume", text: "x" },
    { sendId: "s1", to: "natsume", text: "x", mention: "all" },
    { sendId: "s1", to: "natsume", text: "x", via: "text" },
    "garbage",
  ])("ignores a malformed user-turn-routed payload %j", (payload) => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "unified" });
    const b = createSettingsBridge(t, { windowKind: "pet" });
    const cb = vi.fn();
    b.onUserTurnRouted(cb);

    a.emitUserTurnRouted(payload as never);

    expect(cb).not.toHaveBeenCalled();
  });

  it("delivers a settings page request from a pet window to the settings window", () => {
    const t = createFakeTransport();
    const pet = createSettingsBridge(t, { windowKind: "pet" });
    const settings = createSettingsBridge(t, { windowKind: "settings" });
    const cb = vi.fn();
    settings.onSettingsPage(cb);

    pet.emitSettingsPage({ preset: "a", page: "hist" });
    pet.emitSettingsPage({ preset: null });

    expect(cb.mock.calls).toEqual([[{ preset: "a", page: "hist" }], [{ preset: null }]]);
  });

  it.each([
    [{ preset: 3, page: "conn" }],
    [{ preset: "a", page: "nope" }],
    [{ page: "conn" }],
    ["conn"],
  ])("ignores a malformed settings page request %j", (payload) => {
    const t = createFakeTransport();
    const pet = createSettingsBridge(t, { windowKind: "pet" });
    const settings = createSettingsBridge(t, { windowKind: "settings" });
    const cb = vi.fn();
    settings.onSettingsPage(cb);

    pet.emitSettingsPage(payload as never);

    expect(cb).not.toHaveBeenCalled();
  });

  it.each([
    { sendId: "s1" },
    { sendId: "s1", preset: 7 },
    "garbage",
  ])("ignores a malformed user-turn-done payload %j", (payload) => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "unified" });
    const cb = vi.fn();
    b.onUserTurnDone(cb);

    a.emitUserTurnDone(payload as never);

    expect(cb).not.toHaveBeenCalled();
  });
});

describe("speech stream", () => {
  function pair() {
    const transport = createFakeTransport();
    const pet = createSettingsBridge(transport, { windowKind: "pet" });
    const unified = createSettingsBridge(transport, { windowKind: "unified" });
    const received = vi.fn();
    unified.onSpeechStream(received);
    return { pet, unified, received };
  }

  it.each<MessageSurfaceOp>([
    { op: "commands", commands: [{ name: "status", description: "Info", args: "" }] },
    { op: "command-reply", reply: { kind: "clear" } },
    { op: "command-reply", reply: { kind: "pending", name: "status" } },
    { op: "command-reply", reply: { kind: "settled", name: "status", text: "OK" } },
    { op: "begin" },
    { op: "push", delta: "hi" },
    { op: "end" },
    { op: "end", defer: true },
    { op: "finish" },
    { op: "hide" },
    { op: "quote", quote: { text: "hey", via: "voice", images: 1 } },
    { op: "quote", quote: { text: "hey", via: "text", images: 0, mention: "everyone" } },
    { op: "quote-signals", lines: [{ delivery: "urgent", source: "ci", text: "Build failed" }] },
    { op: "settle-quote" },
    { op: "clear-quote" },
    { op: "busy", busy: true },
    { op: "name", name: "Yui" },
    { op: "summon-input" },
    { op: "input-error", message: "Could not reach the backend" },
  ])("carries %j with its preset", (op) => {
    const { pet, received } = pair();

    pet.emitSpeechStream({ preset: "yui", op });

    expect(received).toHaveBeenCalledExactlyOnceWith({ preset: "yui", op });
  });

  it.each([
    null,
    { preset: "", op: { op: "end" } },
    { preset: "yui", op: "end" },
    { preset: "yui", op: { op: "other" } },
    { preset: "yui", op: { op: "dismiss-input" } },
    { preset: "yui", op: { op: "restore-input", text: "x", images: [] } },
    { preset: "yui", op: { op: "push", delta: 7 } },
    { preset: "yui", op: { op: "quote", quote: { text: "x", via: "fax", images: 0 } } },
    {
      preset: "yui",
      op: { op: "quote", quote: { text: "x", via: "text", images: 0, mention: "all" } },
    },
    {
      preset: "yui",
      op: { op: "quote-signals", lines: [{ delivery: "now", source: "ci", text: "x" }] },
    },
    { preset: "yui", op: { op: "busy", busy: 1 } },
    { preset: "yui", op: { op: "input-error" } },
    ...[
      { op: "commands", commands: [{ name: "status", description: 1, args: "" }] },
      { op: "commands", commands: null },
      { op: "command-reply", reply: { kind: "pending", name: 1 } },
      { op: "command-reply", reply: { kind: "settled", name: "status" } },
      { op: "command-reply", reply: { kind: "other" } },
    ].map((op) => ({ preset: "yui", op })),
  ])("drops the malformed event %j", (payload) => {
    const { pet, received } = pair();

    pet.emitSpeechStream(payload as never);

    expect(received).not.toHaveBeenCalled();
  });

  it("carries the unified window's click on an error's fix back, stamped with the preset", () => {
    const { pet, unified } = pair();
    const control = vi.fn();
    pet.onSpeechStreamControl(control);

    unified.emitSpeechStreamControl({ preset: "yui", op: { op: "input-error-action" } });
    for (const bad of [
      { preset: "", op: { op: "input-error-action" } },
      { preset: "yui", op: { op: "submit", text: "x", images: [] } },
      { preset: "yui" },
    ])
      unified.emitSpeechStreamControl(bad as never);

    expect(control.mock.calls).toEqual([[{ preset: "yui", op: { op: "input-error-action" } }]]);
  });
});

it.each([
  { op: "command", name: "status", args: "" },
  { op: "command-reply-close" },
])("carries a unified command control %j and rejects malformed controls", (op) => {
  const transport = createFakeTransport();
  const pet = createSettingsBridge(transport, { windowKind: "pet" });
  const unified = createSettingsBridge(transport, { windowKind: "unified" });
  const control = vi.fn();
  pet.onSpeechStreamControl(control);
  unified.emitSpeechStreamControl({ preset: "yui", op } as never);
  unified.emitSpeechStreamControl({
    preset: "yui",
    op: { op: "command", name: "status", args: 1 },
  } as never);
  expect(control.mock.calls).toEqual([[{ preset: "yui", op }]]);
  pet.dispose();
  unified.dispose();
});
