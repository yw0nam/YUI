// @vitest-environment jsdom
/**
 * message-bridge.test.ts — the pet ↔ message window bus.
 *
 * Two bridges over one fake transport stand in for the two Tauri windows:
 * surface ops travel pet → message, control ops travel message → pet, and
 * neither side hears its own emit.
 */

import { describe, expect, it, vi } from "vitest";
import { ATTACHMENT_LIMITS_DEFAULTS } from "../config";
import {
  createMessageBridge,
  type MessageControlOp,
  type MessageSurfaceOp,
} from "./message-bridge";
import { createRemoteSurfaces } from "./message-remote";
import type { BridgeTransport } from "./settings-bridge";

function createFakeTransport(): BridgeTransport {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    emit(name, payload) {
      for (const cb of [...(listeners.get(name) ?? [])]) cb(payload);
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

function pair() {
  const transport = createFakeTransport();
  return {
    pet: createMessageBridge(transport, { windowKind: "pet" }),
    message: createMessageBridge(transport, { windowKind: "message" }),
  };
}

const SURFACE_OPS: MessageSurfaceOp[] = [
  { op: "begin" },
  { op: "push", delta: "hello" },
  { op: "end" },
  { op: "end", defer: true },
  { op: "finish" },
  { op: "hide" },
  { op: "summon-input" },
  { op: "dismiss-input" },
  { op: "busy", busy: true },
  { op: "input-enabled", enabled: false },
  { op: "input-error", message: "no backend", action: { label: "Open Advanced" } },
  { op: "attachment-limits", limits: ATTACHMENT_LIMITS_DEFAULTS },
];

const CONTROL_OPS: MessageControlOp[] = [
  { op: "submit", text: "hi", images: ["data:image/jpeg;base64,x"] },
  { op: "stop" },
  { op: "input-open", open: true },
  { op: "input-error-action" },
  { op: "dock" },
  { op: "ready" },
];

describe("createMessageBridge", () => {
  it.each(SURFACE_OPS)("round-trips surface op %j pet → message", (sent) => {
    const { pet, message } = pair();
    const cb = vi.fn();
    message.onSurface(cb);
    pet.emitSurface(sent);
    expect(cb).toHaveBeenCalledWith(sent);
  });

  it.each(CONTROL_OPS)("round-trips control op %j message → pet", (sent) => {
    const { pet, message } = pair();
    const cb = vi.fn();
    pet.onControl(cb);
    message.emitControl(sent);
    expect(cb).toHaveBeenCalledWith(sent);
  });

  it("drops a self-emitted surface op", () => {
    const { pet } = pair();
    const cb = vi.fn();
    pet.onSurface(cb);
    pet.emitSurface({ op: "begin" });
    expect(cb).not.toHaveBeenCalled();
  });

  it("drops a self-emitted control op", () => {
    const { message } = pair();
    const cb = vi.fn();
    message.onControl(cb);
    message.emitControl({ op: "dock" });
    expect(cb).not.toHaveBeenCalled();
  });

  it("keeps the two channels apart", () => {
    const { message } = pair();
    const surface = vi.fn();
    message.onSurface(surface);
    message.emitControl({ op: "dock" });
    expect(surface).not.toHaveBeenCalled();
  });

  it("dispose stops delivery", () => {
    const { pet, message } = pair();
    const cb = vi.fn();
    message.onSurface(cb);
    message.dispose();
    pet.emitSurface({ op: "begin" });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createRemoteSurfaces — the pet-side adapter", () => {
  it("emits a surface op per call", () => {
    const { pet, message } = pair();
    const remote = createRemoteSurfaces(pet);
    const seen: MessageSurfaceOp[] = [];
    message.onSurface((op) => seen.push(op));

    remote.beginSpeech();
    remote.pushSpeech("a");
    remote.endSpeech({ defer: true });
    remote.finishSpeech();
    remote.hideSpeech();
    remote.summonInput();
    remote.dismissInput();
    remote.setBusy(true);
    remote.setInputEnabled(false);
    remote.setAttachmentLimits(ATTACHMENT_LIMITS_DEFAULTS);

    expect(seen).toEqual([
      { op: "begin" },
      { op: "push", delta: "a" },
      { op: "end", defer: true },
      { op: "finish" },
      { op: "hide" },
      { op: "summon-input" },
      { op: "dismiss-input" },
      { op: "busy", busy: true },
      { op: "input-enabled", enabled: false },
      { op: "attachment-limits", limits: ATTACHMENT_LIMITS_DEFAULTS },
    ]);
  });

  it("sends only the action label and runs onClick when the click routes back", () => {
    const { pet, message } = pair();
    const remote = createRemoteSurfaces(pet);
    const seen: MessageSurfaceOp[] = [];
    message.onSurface((op) => seen.push(op));
    const onClick = vi.fn();

    remote.showInputError("no backend", { label: "Open Advanced", onClick });
    expect(seen).toEqual([
      { op: "input-error", message: "no backend", action: { label: "Open Advanced" } },
    ]);

    message.emitControl({ op: "input-error-action" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("mirrors the input-open state reported by the message window", () => {
    const { pet, message } = pair();
    const remote = createRemoteSurfaces(pet);
    expect(remote.isInputOpen()).toBe(false);

    message.emitControl({ op: "input-open", open: true });
    expect(remote.isInputOpen()).toBe(true);

    message.emitControl({ op: "input-open", open: false });
    expect(remote.isInputOpen()).toBe(false);
  });

  it("forwards submit and stop to the registered callbacks", () => {
    const { pet, message } = pair();
    const remote = createRemoteSurfaces(pet);
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    remote.onSubmit(onSubmit);
    remote.onStop(onStop);

    message.emitControl({ op: "submit", text: "hi", images: ["data:x"] });
    message.emitControl({ op: "stop" });

    expect(onSubmit).toHaveBeenCalledWith("hi", ["data:x"]);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("resends the current limits and busy state when a late window reports ready", () => {
    const { pet, message } = pair();
    const remote = createRemoteSurfaces(pet);
    remote.setAttachmentLimits(ATTACHMENT_LIMITS_DEFAULTS);
    remote.setBusy(true);

    const seen: MessageSurfaceOp[] = [];
    message.onSurface((op) => seen.push(op));
    message.emitControl({ op: "ready" });

    expect(seen).toEqual([
      { op: "attachment-limits", limits: ATTACHMENT_LIMITS_DEFAULTS },
      { op: "busy", busy: true },
    ]);
  });

  it("reports a dock request to the registered callback", () => {
    const { pet, message } = pair();
    const remote = createRemoteSurfaces(pet);
    const onDock = vi.fn();
    remote.onDock(onDock);

    message.emitControl({ op: "dock" });
    expect(onDock).toHaveBeenCalledTimes(1);
  });
});
