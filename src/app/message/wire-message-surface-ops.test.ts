import { expect, it, vi } from "vitest";
import type { MessageBridge, MessageSurfaceOp } from "../../io/bridge/message/message-bridge";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import { wireMessageSurfaceOps } from "./wire-message-surface-ops";

function setup() {
  let send!: (op: MessageSurfaceOp) => void;
  const bridge = {
    onSurface: (cb: (op: MessageSurfaceOp) => void) => {
      send = cb;
      return () => {};
    },
    emitControl: vi.fn(),
  } as unknown as MessageBridge;
  const surfaces = {
    beginSpeech: vi.fn(),
    paceSpeech: vi.fn(),
    endSpeech: vi.fn(),
    setBusy: vi.fn(),
    showInputError: vi.fn(),
    showSpeechAction: vi.fn(),
    quoteSignals: vi.fn(),
  } as unknown as Surfaces;
  wireMessageSurfaceOps({ bridge, surfaces });
  return { send, bridge, surfaces };
}

it("begins speech on begin and ends it on end", () => {
  const { send, surfaces } = setup();

  send({ op: "begin" });
  send({ op: "end", defer: true });

  expect(surfaces.beginSpeech).toHaveBeenCalledOnce();
  expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
});

it("begins a paced line and paces each of its sentences", () => {
  const { send, surfaces } = setup();

  send({ op: "begin", paced: true });
  send({ op: "pace", text: "Hi.", durationMs: 500 });

  expect(surfaces.beginSpeech).toHaveBeenCalledWith(undefined, { paced: true });
  expect(surfaces.paceSpeech).toHaveBeenCalledWith({ text: "Hi.", durationMs: 500 });
});

it("sets busy on the surfaces", () => {
  const { send, surfaces } = setup();

  send({ op: "busy", busy: true });

  expect(surfaces.setBusy).toHaveBeenCalledWith(true);
});

it("routes the input-error action click back as a control op", () => {
  const { send, surfaces, bridge } = setup();

  send({ op: "input-error", message: "no", action: { label: "Open" } });

  const action = vi.mocked(surfaces.showInputError).mock.calls[0]![1]!;
  expect(action.label).toBe("Open");
  action.onClick();
  expect(bridge.emitControl).toHaveBeenCalledWith({ op: "input-error-action" });
});

it("routes the speech-action click back as a control op", () => {
  const { send, surfaces, bridge } = setup();

  send({ op: "speech-action", action: { label: "Open Connection" } });

  const action = vi.mocked(surfaces.showSpeechAction).mock.calls[0]![0]!;
  expect(action.label).toBe("Open Connection");
  action.onClick();
  expect(bridge.emitControl).toHaveBeenCalledWith({ op: "speech-action" });
});

it("quotes the source lines on quote-signals", () => {
  const { send, surfaces } = setup();
  const lines = [{ delivery: "urgent" as const, source: "gh", text: "CI failed" }];

  send({ op: "quote-signals", lines });

  expect(surfaces.quoteSignals).toHaveBeenCalledWith(lines);
});
