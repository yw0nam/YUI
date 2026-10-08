import { expect, it, vi } from "vitest";
import type { MessageBridge, MessageSurfaceOp } from "../../io/bridge/message/message-bridge";
import type { MessagePlate } from "../../ui/message/message-plate";
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
    endSpeech: vi.fn(),
    setBusy: vi.fn(),
    showInputError: vi.fn(),
    showSpeechAction: vi.fn(),
  } as unknown as Surfaces;
  const plate = { setLive: vi.fn(), setBusy: vi.fn() } as unknown as MessagePlate;
  wireMessageSurfaceOps({ bridge, surfaces, plate });
  return { send, bridge, surfaces, plate };
}

it("marks the plate live and begins speech on begin, and ends both on end", () => {
  const { send, surfaces, plate } = setup();

  send({ op: "begin" });
  send({ op: "end", defer: true });

  expect(plate.setLive).toHaveBeenNthCalledWith(1, true);
  expect(surfaces.beginSpeech).toHaveBeenCalledOnce();
  expect(plate.setLive).toHaveBeenNthCalledWith(2, false);
  expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
});

it("sets busy on the plate and the surfaces", () => {
  const { send, surfaces, plate } = setup();

  send({ op: "busy", busy: true });

  expect(plate.setBusy).toHaveBeenCalledWith(true);
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
