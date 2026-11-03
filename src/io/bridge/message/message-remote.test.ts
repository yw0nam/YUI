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

it.each([
  { kind: "pending" as const, name: "status" },
  { kind: "settled" as const, name: "status", text: "OK" },
])("restates commands and the last reply on ready: %j", (reply) => {
  let control!: (op: MessageControlOp) => void;
  const bridge = {
    emitSurface: vi.fn(),
    onControl: (cb: typeof control) => {
      control = cb;
      return () => {};
    },
  } as unknown as MessageBridge;
  const remote = createRemoteSurfaces(bridge);
  const commands = [{ name: "status", description: "Info", args: "" }];
  const run = vi.fn();
  remote.onCommand(run);
  remote.setCommands(commands);
  remote.showCommandReply(reply);
  vi.mocked(bridge.emitSurface).mockClear();
  control({ op: "ready" });
  expect(bridge.emitSurface).toHaveBeenCalledWith({ op: "commands", commands });
  expect(bridge.emitSurface).toHaveBeenCalledWith({ op: "command-reply", reply });
  control({ op: "command", name: "status", args: "" });
  expect(run).toHaveBeenCalledWith("status", "");
  remote.dispose();
});
