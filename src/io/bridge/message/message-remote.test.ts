import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

it("replays open and cleared Asks on ready and forwards an Answer", () => {
  let control!: (op: MessageControlOp) => void;
  const bridge = {
    emitSurface: vi.fn(),
    onControl: (cb: typeof control) => {
      control = cb;
      return () => {};
    },
  } as unknown as MessageBridge;
  const remote = createRemoteSurfaces(bridge);
  remote.setAsks([{ type: "ask", ask: { ask_id: "a", prompt: "Run?", choices: [], text: true } }]);
  vi.mocked(bridge.emitSurface).mockClear();
  control({ op: "ready" });
  expect(bridge.emitSurface).toHaveBeenCalledWith({
    op: "asks",
    frames: [{ type: "ask", ask: { ask_id: "a", prompt: "Run?", choices: [], text: true } }],
  });
  remote.setAsks([]);
  vi.mocked(bridge.emitSurface).mockClear();
  control({ op: "ready" });
  expect(bridge.emitSurface).toHaveBeenCalledWith({ op: "asks", frames: [] });
  const answer = vi.fn(() => false);
  remote.onAskAnswer(answer);
  control({ op: "ask-answer", answer: { ask_id: "a", choice: "once" } });
  expect(answer).toHaveBeenCalledExactlyOnceWith({ ask_id: "a", choice: "once" });
  remote.dispose();
});

describe("the streamed deltas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    let control!: (op: MessageControlOp) => void;
    const bridge = {
      emitSurface: vi.fn(),
      onControl: (cb: (op: MessageControlOp) => void) => {
        control = cb;
        return () => {};
      },
    } as unknown as MessageBridge;
    const remote = createRemoteSurfaces(bridge);
    return { bridge, remote, ready: () => control({ op: "ready" }) };
  }

  it("sends the held delta on dispose and leaves no timer", () => {
    const { bridge, remote } = setup();
    remote.pushSpeech("a");
    expect(bridge.emitSurface).not.toHaveBeenCalled();

    remote.dispose();

    expect(vi.mocked(bridge.emitSurface).mock.calls).toEqual([[{ op: "push", delta: "a" }]]);
    vi.advanceTimersByTime(80);
    expect(bridge.emitSurface).toHaveBeenCalledTimes(1);
  });

  it("sends the held delta before the replay the ready brings", () => {
    const { bridge, remote, ready } = setup();
    remote.setName("Yui");
    remote.setBusy(true);
    vi.mocked(bridge.emitSurface).mockClear();

    remote.pushSpeech("a");
    ready();

    expect(vi.mocked(bridge.emitSurface).mock.calls).toEqual([
      [{ op: "push", delta: "a" }],
      [{ op: "name", name: "Yui" }],
      [{ op: "busy", busy: true }],
    ]);
    remote.dispose();
  });
});
