/**
 * bootstrap-wiring.push.test.ts — routing an open push socket into the client.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { wirePushTransport } from "./bootstrap-wiring";
import type { ControlEnvelope } from "./contract";
import { makeTurnOutput } from "./dispatcher/test-helpers";
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

let socket: ReturnType<typeof fakeSocket>;
let expressMotionSettings: ReturnType<typeof fakeMotionSettings>;
let turnOutput: ReturnType<typeof makeTurnOutput>;
let delegations: ReturnType<typeof createDelegationsStore>;
let records: unknown[];
let directives: ControlEnvelope[];

function wire() {
  return wirePushTransport({
    socket,
    turnOutput,
    renderer: { applyDirective: (env) => directives.push(env) },
    delegations,
    expressMotionSettings,
    appendTurnRecord: (record) => records.push(record),
  });
}

beforeEach(() => {
  socket = fakeSocket();
  expressMotionSettings = fakeMotionSettings();
  turnOutput = makeTurnOutput();
  delegations = createDelegationsStore();
  records = [];
  directives = [];
});

describe("wirePushTransport", () => {
  it("plays a render frame through the turn output", () => {
    wire();
    socket.pushRender(RENDER);

    expect(turnOutput.cue).toHaveBeenCalledWith({ emotion_id: "happy" });
    expect(turnOutput.delta).toHaveBeenCalledWith("All green.");
    expect(records).toHaveLength(1);
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

  it("resends the vocabulary when the motion selection changes", () => {
    wire();
    expressMotionSettings.change();

    expect(socket.sendVocabulary).toHaveBeenCalledTimes(1);
  });

  it("drops every subscription on dispose", () => {
    const dispose = wire();
    dispose();

    expect(socket.hasRenderSubscriber()).toBe(false);
    expect(socket.hasDelegationsSubscriber()).toBe(false);
    expect(expressMotionSettings.count()).toBe(0);
  });
});
