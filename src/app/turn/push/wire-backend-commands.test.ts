import { afterEach, expect, it, vi } from "vitest";
import type {
  BackendCommand,
  CommandFrame,
  CommandReplyFrame,
} from "../../../io/chat/push/push-frames";
import type { PushSocketState } from "../../../io/chat/push/push-socket";
import { setLocale } from "../../../ui/i18n";
import { wireBackendCommands } from "./wire-backend-commands";

function setup(isBusy = () => false) {
  let commands!: (list: BackendCommand[]) => void;
  let command!: (name: string, args: string) => void;
  let reply!: (frame: CommandReplyFrame) => void;
  let state!: (value: PushSocketState) => void;
  const socket = {
    getCommands: () => [],
    onCommands: (cb: typeof commands) => {
      commands = cb;
      return () => {};
    },
    onCommandReply: (cb: typeof reply) => {
      reply = cb;
      return () => {};
    },
    onState: (cb: typeof state) => {
      state = cb;
      return () => {};
    },
    sendCommand: vi.fn((_frame: CommandFrame) => true),
  };
  const surfaces = {
    setCommands: vi.fn(),
    showCommandReply: vi.fn(),
    onCommandReplyClose: vi.fn(),
    onCommand: (cb: typeof command) => {
      command = cb;
    },
  };
  const dispose = wireBackendCommands({ socket, surfaces, isBusy });
  return {
    socket,
    surfaces,
    dispose,
    commands: (v: BackendCommand[]) => commands(v),
    command: (name = "status", args = "") => command(name, args),
    reply: (id: string) => reply({ type: "command_reply", id, text: "**OK**" }),
    state: () => state({ kind: "disconnected" }),
  };
}
it("forwards the backend command list", () => {
  const w = setup();
  const list = [{ name: "status", description: "Info", args: "" }];
  w.commands(list);
  expect(w.surfaces.setCommands).toHaveBeenLastCalledWith(list);
  w.dispose();
});
it("sends one pending command and settles its matching reply", () => {
  const w = setup();
  w.command();
  w.command();
  expect(w.socket.sendCommand).toHaveBeenCalledTimes(1);
  const frame = w.socket.sendCommand.mock.calls[0]![0];
  expect(frame).toEqual({ type: "command", id: expect.any(String), name: "status", args: "" });
  expect(w.surfaces.showCommandReply).toHaveBeenLastCalledWith({ kind: "pending", name: "status" });
  w.reply(frame.id);
  expect(w.surfaces.showCommandReply).toHaveBeenLastCalledWith({
    kind: "settled",
    name: "status",
    text: "**OK**",
  });
  w.dispose();
});
it("ignores unrelated reply ids", () => {
  const w = setup();
  w.command();
  w.surfaces.showCommandReply.mockClear();
  w.reply("other");
  expect(w.surfaces.showCommandReply).not.toHaveBeenCalled();
  w.dispose();
});
it("clears the pending command when ready ends", () => {
  const w = setup();
  w.command();
  w.state();
  expect(w.surfaces.showCommandReply).toHaveBeenLastCalledWith({ kind: "clear" });
  w.command();
  expect(w.socket.sendCommand).toHaveBeenCalledTimes(2);
  w.dispose();
});

afterEach(() => setLocale("en"));
it.each([
  ["en", "Not sent. The backend is not connected."],
  ["ja", "送信されませんでした。バックエンドに接続されていません。"],
  ["ko", "전송되지 않았습니다. 백엔드가 연결되어 있지 않습니다."],
] as const)("shows a settled reply when sending fails: %s", (locale, text) => {
  setLocale(locale);
  const w = setup();
  w.socket.sendCommand.mockReturnValueOnce(false);
  w.command();
  expect(w.surfaces.showCommandReply).toHaveBeenLastCalledWith({
    kind: "settled",
    name: "status",
    text,
  });
  w.command();
  expect(w.surfaces.showCommandReply).toHaveBeenLastCalledWith({ kind: "pending", name: "status" });
  w.dispose();
});

it("refuses a stale idle command when the pet is busy", () => {
  const w = setup(() => true);
  w.command();
  expect(w.socket.sendCommand).not.toHaveBeenCalled();
  expect(w.surfaces.showCommandReply).toHaveBeenLastCalledWith({
    kind: "settled",
    name: "status",
    text: "Not run: a reply is still in progress.",
  });
  w.dispose();
});
