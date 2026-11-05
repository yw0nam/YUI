// @vitest-environment jsdom
/**
 * message-bridge.test.ts — the pet ↔ message window bus.
 *
 * Two bridges over one fake transport stand in for the two Tauri windows:
 * surface ops travel pet → message, control ops travel message → pet, and
 * neither side hears its own emit.
 */

import { describe, expect, it, vi } from "vitest";
import type { BridgeTransport } from "../core/bridge-core";
import { createMessageBridge, type MessageControlOp } from "./message-bridge";
import { createRemoteSurfaces } from "./message-remote";
import type { MessageSurfaceOp } from "./surface-ops";

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

const CONTROL_OPS: MessageControlOp[] = [
  { op: "command", name: "status", args: "" },
  { op: "submit", text: "hi", images: ["data:image/jpeg;base64,x"] },
  { op: "stop" },
  { op: "input-open", open: true },
  { op: "input-error-action" },
  { op: "speech-action", index: 1 },
  { op: "dock" },
  { op: "ready" },
];

describe("createMessageBridge", () => {
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

  it.each(["control", "surface"] as const)("isolates message %s by preset", (channel) => {
    const t = createFakeTransport();
    history.replaceState(null, "", "/?preset=a");
    const a = createMessageBridge(t, { windowKind: "pet" });
    history.replaceState(null, "", "/?preset=b");
    const b = createMessageBridge(t, { windowKind: "pet" });
    const sender = createMessageBridge(t, { windowKind: "message" });
    const ca = vi.fn(),
      cb = vi.fn();
    if (channel === "control") {
      a.onControl(ca);
      b.onControl(cb);
      sender.emitControl({ op: "stop" });
    } else {
      a.onSurface(ca);
      b.onSurface(cb);
      sender.emitSurface({ op: "begin" });
    }
    expect(ca).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledTimes(1);
    a.dispose();
    b.dispose();
    sender.dispose();
    history.replaceState(null, "", "/");
  });
});

describe("createRemoteSurfaces — the pet-side adapter", () => {
  it("sends only the speech actions' labels and busy flags, routes a click back by index, and drops the callbacks on replacement", () => {
    const { pet, message } = pair();
    const remote = createRemoteSurfaces(pet);
    const seen: MessageSurfaceOp[] = [];
    message.onSurface((op) => seen.push(op));
    const first = vi.fn();
    const second = vi.fn();

    remote.showSpeechActions([
      { label: "Hear the controls", onClick: first },
      { label: "Hear what she can do", busy: true, onClick: second },
    ]);
    expect(seen).toEqual([
      {
        op: "speech-actions",
        actions: [{ label: "Hear the controls" }, { label: "Hear what she can do", busy: true }],
      },
    ]);

    message.emitControl({ op: "speech-action", index: 1 });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    // New speech replaces the utterance carrying the actions — the routed click finds nothing.
    remote.beginSpeech();
    message.emitControl({ op: "speech-action", index: 1 });
    expect(second).toHaveBeenCalledTimes(1);
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

  it("reports a dock request to the registered callback", () => {
    const { pet, message } = pair();
    const remote = createRemoteSurfaces(pet);
    const onDock = vi.fn();
    remote.onDock(onDock);

    message.emitControl({ op: "dock" });
    expect(onDock).toHaveBeenCalledTimes(1);
  });

  it("reports a settings request to the registered callback", () => {
    const { pet, message } = pair();
    const remote = createRemoteSurfaces(pet);
    const onOpenSettings = vi.fn();
    remote.onOpenSettings(onOpenSettings);

    message.emitControl({ op: "open-settings" });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
