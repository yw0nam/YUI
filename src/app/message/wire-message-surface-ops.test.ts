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
    endSpeech: vi.fn(),
    setBusy: vi.fn(),
    setAsks: vi.fn(),
    onAskAnswer: vi.fn(),
    setCommands: vi.fn(),
    showCommandReply: vi.fn(),
    onCommandReplyClose: vi.fn(),
    showInputError: vi.fn(),
    showSpeechActions: vi.fn(),
    quoteSignals: vi.fn(),
  } as unknown as Surfaces;
  const name = { set: vi.fn() };
  wireMessageSurfaceOps({ bridge, surfaces, name });
  return { send, bridge, surfaces, name };
}

it("begins speech on begin and ends it on end", () => {
  const { send, surfaces } = setup();

  send({ op: "begin" });
  send({ op: "end", defer: true });

  expect(surfaces.beginSpeech).toHaveBeenCalledOnce();
  expect(surfaces.endSpeech).toHaveBeenCalledWith({ defer: true });
});

it("takes the character's name the pet window sends", () => {
  const { send, name } = setup();

  send({ op: "name", name: "Yui" });

  expect(name.set).toHaveBeenCalledWith("Yui");
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

it("relays each speech action's busy flag and routes its click back as a control op carrying its index", () => {
  const { send, surfaces, bridge } = setup();

  send({
    op: "speech-actions",
    actions: [{ label: "Hear the controls" }, { label: "Connecting…", busy: true }],
  });

  const actions = vi.mocked(surfaces.showSpeechActions).mock.calls[0]![0];
  expect(actions.map((a) => [a.label, a.busy])).toEqual([
    ["Hear the controls", undefined],
    ["Connecting…", true],
  ]);
  actions[1]!.onClick();
  expect(bridge.emitControl).toHaveBeenCalledWith({ op: "speech-action", index: 1 });
});

it("quotes the source lines on quote-signals", () => {
  const { send, surfaces } = setup();
  const lines = [{ delivery: "urgent" as const, source: "gh", text: "CI failed" }];

  send({ op: "quote-signals", lines });

  expect(surfaces.quoteSignals).toHaveBeenCalledWith(lines);
});

it("draws the commands and reply received over the bridge", () => {
  const { send, surfaces } = setup();
  const commands = [{ name: "status", description: "Info", args: "" }];
  const reply = { kind: "settled" as const, name: "status", text: "OK" };
  send({ op: "commands", commands });
  send({ op: "command-reply", reply });
  expect(surfaces.setCommands).toHaveBeenCalledWith(commands);
  expect(surfaces.showCommandReply).toHaveBeenCalledWith(reply);
});

it("renders the Ask list and sends its Answer through control", () => {
  const { send, surfaces, bridge } = setup();
  send({
    op: "asks",
    frames: [{ type: "ask", ask: { ask_id: "a", prompt: "Run?", choices: [], text: true } }],
  });
  expect(surfaces.setAsks).toHaveBeenCalledExactlyOnceWith([
    { type: "ask", ask: { ask_id: "a", prompt: "Run?", choices: [], text: true } },
  ]);
  expect(vi.mocked(surfaces.onAskAnswer).mock.calls[0]![0]({ ask_id: "a", text: "yes" })).toBe(
    true,
  );
  expect(bridge.emitControl).toHaveBeenCalledExactlyOnceWith({
    op: "ask-answer",
    answer: { ask_id: "a", text: "yes" },
  });
});
