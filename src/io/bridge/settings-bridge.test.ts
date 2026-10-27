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

import { describe, expect, it, vi } from "vitest";
import type { BridgeTransport } from "./core/bridge-core";
import type { MessageSurfaceOp } from "./message/message-bridge";
import { createSettingsBridge } from "./settings-bridge";

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

describe("createSettingsBridge", () => {
  it("delivers mouth-preview from A to B with the payload value", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const cb = vi.fn();
    b.onMouthPreview(cb);

    a.emitMouthPreview(0.3);
    expect(cb).toHaveBeenCalledWith(0.3);

    a.emitMouthPreview(null);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it("delivers settings-changed from A to B", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const cb = vi.fn();
    b.onSettingsChanged(cb);

    a.emitSettingsChanged();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("delivers settings-changed with the sending window kind", () => {
    const t = createFakeTransport();
    const devtools = createSettingsBridge(t, { windowKind: "devtools" });
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const cb = vi.fn();
    b.onSettingsChanged(cb);

    devtools.emitSettingsChanged();
    expect(cb).toHaveBeenCalledWith("devtools");
  });

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

  it("delivers voice-set true/false from A to B", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const cb = vi.fn();
    b.onVoiceSet(cb);

    a.emitVoiceSet(true);
    expect(cb).toHaveBeenLastCalledWith(true);
    a.emitVoiceSet(false);
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it("delivers voice-state snapshot from A to B", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const cb = vi.fn();
    b.onVoiceState(cb);

    a.emitVoiceState({ state: "listening" });
    expect(cb).toHaveBeenCalledWith({ state: "listening" });
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

  it("delivers a reasoning state from A to B", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "message" });
    const cb = vi.fn();
    b.onReasoning(cb);

    a.emitReasoning({ text: "checking the logs", live: true });

    expect(cb).toHaveBeenCalledWith({ text: "checking the logs", live: true });
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

  it("delivers a reasoning ask from A to B", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "pet" });
    const b = createSettingsBridge(t, { windowKind: "message" });
    const ask = vi.fn();
    a.onReasoningAsk(ask);

    b.emitReasoningAsk();

    expect(ask).toHaveBeenCalledTimes(1);
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

  it("delivers the active preset id from A to B", () => {
    const t = createFakeTransport();
    const a = createSettingsBridge(t, { windowKind: "settings" });
    const b = createSettingsBridge(t, { windowKind: "pet" });
    const cb = vi.fn();
    b.onPresetChanged(cb);

    a.emitPresetChanged({ active: "aaaa0001" });

    expect(cb).toHaveBeenCalledWith({ active: "aaaa0001" });
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
    ["onSettingsChanged", undefined, false],
    ["onPresetChanged", { active: "b" }, false],
    ["onPetWindowsChanged", undefined, false],
    ["onMouthPreview", 0.3, true],
    ["onVoiceSet", true, false],
    ["onVoiceState", { state: "idle" }, false],
    ["onPushState", { kind: "disconnected" }, true],
    ["onPushStateAsk", undefined, true],
    ["onPushReset", undefined, true],
    ["onSessionReset", "a", true],
    ["onPushReconnect", undefined, true],
    ["onDelegations", [], true],
    ["onDelegationsAsk", undefined, true],
    ["onReasoning", { text: "x", live: true }, true],
    ["onReasoningAsk", undefined, true],
    ["onHelpGuide", { guide: "controls", text: "help" }, true],
    ["onCharacterAddressed", { from: "p1", name: "Perlica", to: "p2", text: "x", ts: 1 }, false],
    ["onUserTurnRouted", { sendId: "s1", to: "p2", text: "x" }, false],
    ["onSpeechStream", { preset: "p2", op: { op: "push", delta: "hi" } }, false],
    ["onSpeechStreamAsk", undefined, false],
    ["onStopTurns", undefined, false],
    ["onSpeechStreamControl", { preset: "p2", op: { op: "input-error-action" } }, false],
    ["onUserTurnDone", { sendId: "s1", preset: "p2" }, false],
    ["onSettingsPage", { preset: "p2", page: "conn" }, false],
    ["onOpenDevtools", undefined, false],
    ["onQuickCardOpen", { left: 1, right: 200, y: 30 }, true],
    ["onQuickCardReady", undefined, true],
  ] as const)("%s uses its declared preset scope", (method, payload, scoped) => {
    history.replaceState(null, "", "/?preset=a");
    const t = createFakeTransport();
    const bridge = createSettingsBridge(t, { windowKind: "pet" });
    const cb = vi.fn();
    bridge[method](cb);
    const name = [...t.listeners.keys()][0]!;
    for (const tag of ["b", undefined, "a"])
      t.emit(name, { __src: "other", __kind: "settings", __preset: tag, payload });
    expect(cb).toHaveBeenCalledTimes(scoped ? 1 : 3);
    bridge.dispose();
    history.replaceState(null, "", "/");
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

  it("delivers a speech onset from one window to another", () => {
    const t = createFakeTransport();
    const main = createSettingsBridge(t, { windowKind: "pet" });
    const unified = createSettingsBridge(t, { windowKind: "unified" });
    const cb = vi.fn();
    unified.onSpeechOnset(cb);

    main.emitSpeechOnset();

    expect(cb).toHaveBeenCalledOnce();
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

  it("delivers an open-devtools request from the settings window to the pet window", () => {
    const t = createFakeTransport();
    const settings = createSettingsBridge(t, { windowKind: "settings" });
    const pet = createSettingsBridge(t, { windowKind: "pet" });
    const cb = vi.fn();
    pet.onOpenDevtools(cb);

    settings.emitOpenDevtools();

    expect(cb).toHaveBeenCalledOnce();
  });

  it("delivers a stop from the unified window to every pet window", () => {
    const t = createFakeTransport();
    const unified = createSettingsBridge(t, { windowKind: "unified" });
    const pets = [
      createSettingsBridge(t, { windowKind: "pet" }),
      createSettingsBridge(t, { windowKind: "pet" }),
    ];
    const stops = pets.map((pet) => {
      const cb = vi.fn();
      pet.onStopTurns(cb);
      return cb;
    });

    unified.emitStopTurns();

    for (const cb of stops) expect(cb).toHaveBeenCalledOnce();
  });

  it("delivers a user-turn-done event from a pet window to the unified window", () => {
    const t = createFakeTransport();
    const pet = createSettingsBridge(t, { windowKind: "pet" });
    const unified = createSettingsBridge(t, { windowKind: "unified" });
    const cb = vi.fn();
    unified.onUserTurnDone(cb);

    pet.emitUserTurnDone({ sendId: "s1", preset: "natsume" });

    expect(cb).toHaveBeenCalledExactlyOnceWith({ sendId: "s1", preset: "natsume" });
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
    { op: "begin" },
    { op: "begin", paced: true },
    { op: "push", delta: "hi" },
    { op: "pace", text: "Hi.", durationMs: 1200 },
    { op: "pace", text: "Hi.", durationMs: null },
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
    { preset: "yui", op: { op: "pace", text: "Hi.", durationMs: "1200" } },
    { preset: "yui", op: { op: "pace", text: "Hi.", durationMs: Number.NaN } },
    { preset: "yui", op: { op: "pace", text: "Hi.", durationMs: Number.POSITIVE_INFINITY } },
    { preset: "yui", op: { op: "pace", text: "Hi.", durationMs: -1 } },
    { preset: "yui", op: { op: "begin", paced: "yes" } },
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

  it("delivers an ask from the unified window to a pet window", () => {
    const { pet, unified } = pair();
    const ask = vi.fn();
    pet.onSpeechStreamAsk(ask);

    unified.emitSpeechStreamAsk();

    expect(ask).toHaveBeenCalledOnce();
  });
});
