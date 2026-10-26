import { expect, it, vi } from "vitest";
import type { MessageBridge, MessageControlOp } from "./message-bridge";
import { createRemoteSurfaces } from "./message-remote";

it("sends the character's name, and sends it again to a message window that comes up later", () => {
  let control!: (op: MessageControlOp) => void;
  const bridge = {
    emitSurface: vi.fn(),
    onControl: (cb: (op: MessageControlOp) => void) => {
      control = cb;
      return () => {};
    },
  } as unknown as MessageBridge;
  const remote = createRemoteSurfaces(bridge);

  remote.setName("Yui");
  expect(bridge.emitSurface).toHaveBeenLastCalledWith({ op: "name", name: "Yui" });

  vi.mocked(bridge.emitSurface).mockClear();
  control({ op: "ready" });
  expect(bridge.emitSurface).toHaveBeenCalledWith({ op: "name", name: "Yui" });
});
