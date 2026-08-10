// @vitest-environment jsdom
/**
 * settings-bridge.test.ts — cross-window settings bridge.
 *
 * Pins the contract for src/io/settings-bridge.ts:
 *   createSettingsBridge(transport, { windowKind }) builds a typed bus over an injectable transport.
 *   Two bridge instances sharing one fake transport simulate two Tauri windows —
 *   an emit on A delivers to the matching on* callback on B.
 *   Disposers (per-listener and dispose()) stop delivery.
 *
 * The default transport selection (Tauri dynamic import / BroadcastChannel / no-op)
 * is integration and intentionally not unit-tested here.
 */

import { describe, expect, it, vi } from "vitest";
import { type BridgeTransport, createSettingsBridge } from "./settings-bridge";

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

  it("delivers a legacy envelope as an unknown window kind", () => {
    const t = createFakeTransport();
    const b = createSettingsBridge(t, { windowKind: "settings" });
    const changed = vi.fn();
    const mouth = vi.fn();
    b.onSettingsChanged(changed);
    b.onMouthPreview(mouth);

    // Pre-envelope emits carry the bare payload with no __src/__kind fields.
    t.emit("yui://settings-changed", undefined);
    t.emit("yui://mouth-preview", 0.25);

    expect(changed).toHaveBeenCalledWith("unknown");
    expect(mouth).toHaveBeenCalledWith(0.25);
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
});
