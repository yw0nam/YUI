/**
 * bootstrap-wiring.push.test.ts — routing an open push socket into the client.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { wirePushMode, wirePushTransport } from "./bootstrap-wiring";
import type { ControlEnvelope } from "./contract";
import { makeTurnOutput } from "./dispatcher/test-helpers";
import type { ChatHistoryEntry } from "./io/chat-history-store";
import { createDelegationsStore } from "./io/delegations-store";
import type { DelegationItem, RenderFrame } from "./io/push-socket";

function fakeSocket() {
  let renderCb: ((frame: RenderFrame) => void) | null = null;
  let delegationsCb: ((items: DelegationItem[]) => void) | null = null;
  return {
    sendVocabulary: vi.fn(),
    onRender(cb: (frame: RenderFrame) => void) {
      renderCb = cb;
      return () => {
        renderCb = null;
      };
    },
    onDelegations(cb: (items: DelegationItem[]) => void) {
      delegationsCb = cb;
      return () => {
        delegationsCb = null;
      };
    },
    pushRender(frame: RenderFrame): void {
      renderCb?.(frame);
    },
    pushDelegations(items: DelegationItem[]): void {
      delegationsCb?.(items);
    },
    hasRenderSubscriber: () => renderCb !== null,
    hasDelegationsSubscriber: () => delegationsCb !== null,
  };
}

function fakeMotionSettings() {
  const subs = new Set<() => void>();
  return {
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    change(): void {
      for (const cb of subs) cb();
    },
    count: () => subs.size,
  };
}

const RENDER: RenderFrame = {
  type: "render",
  turn_id: "7",
  source: "hermes",
  segments: [{ cues: [{ emotion_id: "happy" }], speech: "All green." }],
};

function fakeLog() {
  return { info: vi.fn(), warn: () => {}, error: () => {}, debug: () => {} };
}

let socket: ReturnType<typeof fakeSocket>;
let turnOutput: ReturnType<typeof makeTurnOutput>;
let delegations: ReturnType<typeof createDelegationsStore>;
let records: unknown[];
let directives: ControlEnvelope[];
let transcript: ChatHistoryEntry[];
let log: ReturnType<typeof fakeLog>;

function wire() {
  return wirePushTransport({
    socket,
    turnOutput,
    renderer: { applyDirective: (env) => directives.push(env) },
    delegations,
    appendTurnRecord: (record) => records.push(record),
    appendTranscript: (entry) => transcript.push(entry),
    log,
  });
}

beforeEach(() => {
  socket = fakeSocket();
  turnOutput = makeTurnOutput();
  delegations = createDelegationsStore();
  records = [];
  directives = [];
  transcript = [];
  log = fakeLog();
});

describe("wirePushTransport", () => {
  it("plays a render frame through the turn output", () => {
    wire();
    socket.pushRender(RENDER);

    expect(turnOutput.cue).toHaveBeenCalledWith({ emotion_id: "happy" });
    // The trailing newline is the segment boundary render-turn closes each segment with.
    expect(turnOutput.delta).toHaveBeenCalledWith("All green.\n");
    expect(records).toHaveLength(1);
  });

  it("puts a spoken reply in the transcript it was given", () => {
    wire();
    socket.pushRender(RENDER);

    expect(transcript).toEqual([{ role: "assistant", text: "All green.", ts: expect.any(Number) }]);
  });

  it("renders a silent frame's cues through the renderer it was given", () => {
    wire();
    socket.pushRender({
      type: "render",
      turn_id: null,
      source: "hermes",
      segments: [{ cues: [{ emotion_id: "sad" }], speech: "[SILENT]" }],
    });

    expect(directives).toEqual([{ speech_text: "", emotion: { id: "sad" } }]);
  });

  it("replaces the delegations list with each frame", () => {
    wire();
    socket.pushDelegations([
      { id: "d-1", title: "Sort the list", started_at: 1, state: "running" },
    ]);

    expect(delegations.get().map((d) => d.id)).toEqual(["d-1"]);
  });

  it("logs one info line per delegations frame with the total and running counts", () => {
    wire();
    socket.pushDelegations([
      { id: "d-1", title: "Sort the list", started_at: 1, state: "running" },
      { id: "d-2", title: "Done already", started_at: 1, state: "done", ended_at: 2 },
    ]);

    expect(log.info).toHaveBeenCalledExactlyOnceWith("delegations", { total: 2, running: 1 });
  });

  it("drops every subscription on dispose", () => {
    const dispose = wire();
    dispose();

    expect(socket.hasRenderSubscriber()).toBe(false);
    expect(socket.hasDelegationsSubscriber()).toBe(false);
  });
});

describe("wirePushMode", () => {
  let connect: Mock<() => void>;
  let disconnect: Mock<() => void>;
  let chipCreate: Mock<() => void>;
  let chipDispose: Mock<() => void>;
  let endpoints: { chat_api?: string; chat_base_url: string };
  let endpointsSettings: ReturnType<typeof fakeMotionSettings>;
  let chatKeySettings: ReturnType<typeof fakeMotionSettings>;

  function wireMode() {
    return wirePushMode({
      socket: { connect, disconnect },
      chip: { create: chipCreate, dispose: chipDispose },
      getEndpoints: () => endpoints as never,
      endpointsSettings,
      chatKeySettings,
    });
  }

  beforeEach(() => {
    connect = vi.fn<() => void>();
    disconnect = vi.fn<() => void>();
    chipCreate = vi.fn<() => void>();
    chipDispose = vi.fn<() => void>();
    endpoints = { chat_api: "push", chat_base_url: "http://localhost:8646" };
    endpointsSettings = fakeMotionSettings();
    chatKeySettings = fakeMotionSettings();
  });

  it("connects straight away when the mode is push and an endpoint is set", () => {
    wireMode();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("stays down in the other protocol modes", () => {
    endpoints.chat_api = "responses";
    wireMode();

    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("stays down while the chat endpoint is empty", () => {
    endpoints.chat_base_url = "   ";
    wireMode();

    expect(connect).not.toHaveBeenCalled();
  });

  it("connects when the user switches into push mode", () => {
    endpoints.chat_api = "chat_completions";
    wireMode();

    endpoints.chat_api = "push";
    endpointsSettings.change();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("connects when the user fills in the endpoint afterwards", () => {
    endpoints.chat_base_url = "";
    wireMode();

    endpoints.chat_base_url = "http://localhost:8646";
    endpointsSettings.change();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("disconnects when the user leaves push mode", () => {
    wireMode();

    endpoints.chat_api = "responses";
    endpointsSettings.change();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("reopens on the new endpoint when the URL is edited", () => {
    wireMode();

    endpoints.chat_base_url = "https://agent.example:9000";
    endpointsSettings.change();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("reopens so the next attempt carries the edited key", () => {
    wireMode();
    chatKeySettings.change();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("leaves the open socket alone when nothing about the connection changed", () => {
    wireMode();
    endpointsSettings.change();

    expect(disconnect).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("ignores a key edit while the mode is not push", () => {
    endpoints.chat_api = "responses";
    wireMode();
    chatKeySettings.change();

    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("does not disconnect twice when the mode is left and left again", () => {
    wireMode();
    endpoints.chat_api = "responses";
    endpointsSettings.change();
    endpointsSettings.change();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates the chip straight away when starting in push mode", () => {
    wireMode();
    expect(chipCreate).toHaveBeenCalledTimes(1);
  });

  it("never creates the chip in the other protocol modes", () => {
    endpoints.chat_api = "responses";
    wireMode();

    expect(chipCreate).not.toHaveBeenCalled();
  });

  it("creates the chip even while the endpoint is unset", () => {
    endpoints.chat_base_url = "";
    wireMode();

    expect(chipCreate).toHaveBeenCalledTimes(1);
  });

  it("creates the chip when the user switches into push mode", () => {
    endpoints.chat_api = "chat_completions";
    wireMode();

    endpoints.chat_api = "push";
    endpointsSettings.change();

    expect(chipCreate).toHaveBeenCalledTimes(1);
    expect(chipDispose).not.toHaveBeenCalled();
  });

  it("disposes the chip when the user leaves push mode", () => {
    wireMode();

    endpoints.chat_api = "responses";
    endpointsSettings.change();

    expect(chipDispose).toHaveBeenCalledTimes(1);
  });

  it("does not recreate the chip on an endpoint or key edit while staying in push mode", () => {
    wireMode();

    endpoints.chat_base_url = "https://agent.example:9000";
    endpointsSettings.change();
    chatKeySettings.change();

    expect(chipCreate).toHaveBeenCalledTimes(1);
    expect(chipDispose).not.toHaveBeenCalled();
  });

  it("disposes the chip on teardown while the mode is still push", () => {
    const dispose = wireMode();
    dispose();

    expect(chipDispose).toHaveBeenCalledTimes(1);
  });

  it("does not dispose the chip again on teardown once the mode already left push", () => {
    const dispose = wireMode();
    endpoints.chat_api = "responses";
    endpointsSettings.change();
    dispose();

    expect(chipDispose).toHaveBeenCalledTimes(1);
  });

  it("drops both subscriptions on dispose", () => {
    wireMode()();

    expect(endpointsSettings.count()).toBe(0);
    expect(chatKeySettings.count()).toBe(0);
  });
});
