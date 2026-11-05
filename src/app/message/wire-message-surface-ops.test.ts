// @vitest-environment jsdom
/**
 * Every pet → message surface op, sent through `createRemoteSurfaces` in the pet window and drawn by
 * `wireMessageSurfaceOps` in the message window, over one fake transport that copies each payload
 * the way a webview event does.
 */

import { beforeEach, expect, it, vi } from "vitest";
import { guardrailsFixture } from "../../config/load-test-helpers";
import type { BridgeTransport } from "../../io/bridge/core/bridge-core";
import { createMessageBridge } from "../../io/bridge/message/message-bridge";
import { createRemoteSurfaces, type RemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { MessageSurfaceOp, surfaceOps } from "../../io/bridge/message/surface-ops";
import { focusWindow } from "../../io/window/geometry/companion-column";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import { wireMessageSurfaceOps } from "./wire-message-surface-ops";

const { log } = vi.hoisted(() => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../logger", () => ({ createLogger: () => log }));
vi.mock("../../io/window/geometry/companion-column", () => ({ focusWindow: vi.fn() }));

const LIMITS = guardrailsFixture().attachments;
const FRAMES = [
  { type: "ask" as const, ask: { ask_id: "a", prompt: "Run?", choices: [], text: true } },
];
const COMMANDS = [{ name: "status", description: "Info", args: "" }];
const REPLY = { kind: "settled" as const, name: "status", text: "OK" };
const QUOTE = { text: "hi", via: "voice" as const, images: 1 };
const LINES = [{ delivery: "urgent" as const, source: "gh", text: "CI failed" }];
const IMAGES = ["data:image/jpeg;base64,x"];
const click = expect.any(Function);

const RECEIVER_METHODS = [
  "setAsks",
  "setCommands",
  "showCommandReply",
  "beginSpeech",
  "pushSpeech",
  "endSpeech",
  "finishSpeech",
  "hideSpeech",
  "summonInput",
  "dismissInput",
  "setBusy",
  "showInputError",
  "showSpeechActions",
  "setAttachmentLimits",
  "quoteUser",
  "quoteSignals",
  "settleQuote",
  "clearQuote",
  "restoreInput",
] as const;

/** A copy of `message-bridge.test.ts`'s transport that also records each payload before the copy. */
function createFakeTransport(sent: unknown[]): BridgeTransport {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    emit(name, payload) {
      sent.push((payload as { payload: unknown }).payload);
      for (const cb of [...(listeners.get(name) ?? [])]) cb(JSON.parse(JSON.stringify(payload)));
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

function setup() {
  const sent: unknown[] = [];
  const received: [string, unknown[]][] = [];
  const transport = createFakeTransport(sent);
  const petBridge = createMessageBridge(transport, { windowKind: "pet" });
  const messageBridge = createMessageBridge(transport, { windowKind: "message" });
  const remote = createRemoteSurfaces(petBridge);
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      received.push([method, args]);
    };
  const fake = {
    ...Object.fromEntries(RECEIVER_METHODS.map((m) => [m, vi.fn(record(m))])),
    onAskAnswer: vi.fn(),
    onCommandReplyClose: vi.fn(),
  } as unknown as Surfaces;
  const name = { set: vi.fn(record("name.set")) };
  vi.mocked(focusWindow).mockImplementation(async (window) => {
    await Promise.resolve();
    received.push(["focusWindow", [window]]);
  });
  wireMessageSurfaceOps({ bridge: messageBridge, surfaces: fake, name });
  sent.length = 0;
  return { sent, received, remote, petBridge, fake };
}

beforeEach(() => {
  vi.useFakeTimers();
  return () => vi.useRealTimers();
});

interface Row {
  /** The case title; the op name when absent. */
  title?: string;
  send(remote: RemoteSurfaces): void;
  wire: MessageSurfaceOp;
  received: [string, unknown[]][];
}

const ROWS: Record<keyof typeof surfaceOps, Row[]> = {
  asks: [
    {
      send: (r) => r.setAsks(FRAMES),
      wire: { op: "asks", frames: FRAMES },
      received: [["setAsks", [FRAMES]]],
    },
  ],
  commands: [
    {
      send: (r) => r.setCommands(COMMANDS),
      wire: { op: "commands", commands: COMMANDS },
      received: [["setCommands", [COMMANDS]]],
    },
  ],
  "command-reply": [
    {
      send: (r) => r.showCommandReply(REPLY),
      wire: { op: "command-reply", reply: REPLY },
      received: [["showCommandReply", [REPLY]]],
    },
  ],
  "attachment-limits": [
    {
      send: (r) => r.setAttachmentLimits(LIMITS),
      wire: { op: "attachment-limits", limits: LIMITS },
      received: [["setAttachmentLimits", [LIMITS]]],
    },
  ],
  name: [
    {
      send: (r) => r.setName("Yui"),
      wire: { op: "name", name: "Yui" },
      received: [["name.set", ["Yui"]]],
    },
  ],
  busy: [
    {
      send: (r) => r.setBusy(true),
      wire: { op: "busy", busy: true },
      received: [["setBusy", [true]]],
    },
  ],
  begin: [{ send: (r) => r.beginSpeech(), wire: { op: "begin" }, received: [["beginSpeech", []]] }],
  push: [
    {
      send: (r) => r.pushSpeech("hello"),
      wire: { op: "push", delta: "hello" },
      received: [["pushSpeech", ["hello"]]],
    },
  ],
  end: [
    {
      title: "end with no options",
      send: (r) => r.endSpeech(),
      wire: { op: "end" },
      received: [["endSpeech", [undefined]]],
    },
    {
      title: "end deferred",
      send: (r) => r.endSpeech({ defer: true }),
      wire: { op: "end", defer: true },
      received: [["endSpeech", [{ defer: true }]]],
    },
    {
      title: "end with defer false",
      send: (r) => r.endSpeech({ defer: false }),
      wire: { op: "end" },
      received: [["endSpeech", [undefined]]],
    },
  ],
  finish: [
    { send: (r) => r.finishSpeech(), wire: { op: "finish" }, received: [["finishSpeech", []]] },
  ],
  hide: [{ send: (r) => r.hideSpeech(), wire: { op: "hide" }, received: [["hideSpeech", []]] }],
  "summon-input": [
    {
      title: "summon-input after focus",
      send: (r) => r.summonInput(),
      wire: { op: "summon-input" },
      received: [
        ["focusWindow", ["message"]],
        ["summonInput", []],
      ],
    },
  ],
  "dismiss-input": [
    {
      send: (r) => r.dismissInput(),
      wire: { op: "dismiss-input" },
      received: [["dismissInput", []]],
    },
  ],
  "input-error": [
    {
      title: "input-error with an action",
      send: (r) => r.showInputError("no backend", { label: "Open Advanced", onClick: vi.fn() }),
      wire: { op: "input-error", message: "no backend", action: { label: "Open Advanced" } },
      received: [["showInputError", ["no backend", { label: "Open Advanced", onClick: click }]]],
    },
    {
      title: "input-error with no action",
      send: (r) => r.showInputError("no backend"),
      wire: { op: "input-error", message: "no backend" },
      received: [["showInputError", ["no backend", undefined]]],
    },
  ],
  "speech-actions": [
    {
      title: "speech-actions with a busy action",
      send: (r) =>
        r.showSpeechActions([
          { label: "Hear the controls", onClick: vi.fn() },
          { label: "Connecting…", busy: true, onClick: vi.fn() },
        ]),
      wire: {
        op: "speech-actions",
        actions: [{ label: "Hear the controls" }, { label: "Connecting…", busy: true }],
      },
      received: [
        [
          "showSpeechActions",
          [
            [
              { label: "Hear the controls", busy: undefined, onClick: click },
              { label: "Connecting…", busy: true, onClick: click },
            ],
          ],
        ],
      ],
    },
  ],
  quote: [
    {
      send: (r) => r.quoteUser(QUOTE),
      wire: { op: "quote", quote: QUOTE },
      received: [["quoteUser", [QUOTE]]],
    },
  ],
  "quote-signals": [
    {
      send: (r) => r.quoteSignals(LINES),
      wire: { op: "quote-signals", lines: LINES },
      received: [["quoteSignals", [LINES]]],
    },
  ],
  "settle-quote": [
    { send: (r) => r.settleQuote(), wire: { op: "settle-quote" }, received: [["settleQuote", []]] },
  ],
  "clear-quote": [
    { send: (r) => r.clearQuote(), wire: { op: "clear-quote" }, received: [["clearQuote", []]] },
  ],
  "restore-input": [
    {
      send: (r) => r.restoreInput("hi", IMAGES),
      wire: { op: "restore-input", text: "hi", images: IMAGES },
      received: [["restoreInput", ["hi", IMAGES]]],
    },
  ],
};

it.each(
  Object.entries(ROWS).flatMap(([op, rows]) =>
    rows.map((row) => ({ ...row, title: row.title ?? op })),
  ),
)("carries $title from the pet window to the message window's surfaces", async (row) => {
  const { sent, received, remote } = setup();

  row.send(remote);
  await vi.advanceTimersByTimeAsync(40);

  expect(sent).toStrictEqual([row.wire]);
  expect(received).toStrictEqual(row.received);
});

it.each([
  {
    title: "the input error action",
    show: (r: RemoteSurfaces, onClick: () => void) =>
      r.showInputError("no backend", { label: "Open Advanced", onClick }),
    clickReceived: (fake: Surfaces) => vi.mocked(fake.showInputError).mock.calls[0]![1]!.onClick(),
  },
  {
    title: "the second speech action",
    show: (r: RemoteSurfaces, onClick: () => void) =>
      r.showSpeechActions([
        { label: "Hear the controls", onClick: vi.fn() },
        { label: "Connecting…", onClick },
      ]),
    clickReceived: (fake: Surfaces) =>
      vi.mocked(fake.showSpeechActions).mock.calls[0]![0][1]!.onClick(),
  },
])("runs the pet-side click of $title when the message window's copy is clicked", async (row) => {
  const { fake, remote } = setup();
  const onClick = vi.fn();
  row.show(remote, onClick);
  await vi.advanceTimersByTimeAsync(40);

  row.clickReceived(fake);

  expect(onClick).toHaveBeenCalledExactlyOnceWith();
});

it("hands the Ask answer the message window reports to the pet window", () => {
  const { fake, remote } = setup();
  const onAnswer = vi.fn(() => true);
  remote.onAskAnswer(onAnswer);

  const answered = vi.mocked(fake.onAskAnswer).mock.calls[0]![0]({ ask_id: "a", text: "yes" });

  expect(answered).toBe(true);
  expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ ask_id: "a", text: "yes" });
});

it.each(["nope", "toString"])("logs an op named %s that has no entry and draws nothing", (name) => {
  const { petBridge, received } = setup();

  petBridge.emitSurface({ op: name } as unknown as MessageSurfaceOp);

  expect(log.warn).toHaveBeenCalledExactlyOnceWith("unhandled_surface_op", {
    op: JSON.stringify({ op: name }),
  });
  expect(received).toStrictEqual([]);
});
