/**
 * turn-feed.test.ts — the owner slots over a real reasoning store and a recording tool sink.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ToolStatus } from "../../contract";
import { createReasoningStore } from "../../io/bridge/reasoning-store";
import { createTurnFeed } from "./turn-feed";

let sink: Mock<(status: ToolStatus) => void>;
let store: ReturnType<typeof createReasoningStore>;
let feed: ReturnType<typeof createTurnFeed>;

beforeEach(() => {
  sink = vi.fn();
  store = createReasoningStore();
  feed = createTurnFeed({ onToolStatus: sink, reasoning: store });
});

describe("turnFeed — tool slot", () => {
  it("a late done of an older turn leaves the newer turn's running chip alone", () => {
    feed.toolStatus("push:turn:a", "running", "t1");
    feed.toolStatus("push:turn:b", "running", "t2");
    feed.toolStatus("push:turn:a", "done", "t1");

    expect(sink).toHaveBeenLastCalledWith({ state: "running", tool_id: "t2" });

    feed.ended("push:turn:a");
    expect(sink).not.toHaveBeenCalledWith({ state: "idle" });

    feed.ended("push:turn:b");
    expect(sink).toHaveBeenLastCalledWith({ state: "idle" });
    expect(sink).toHaveBeenCalledTimes(3);
  });
});

describe("turnFeed — reasoning cycle", () => {
  it("a new owner's delta abandons the live cycle; only its own end or reply closes it", () => {
    feed.reasoning("stream:1", "a");
    feed.reasoning("stream:2", "b");

    expect(store.get()).toEqual({ text: "b", live: true });

    feed.ended("stream:1");
    expect(store.get()).toEqual({ text: "b", live: true });

    feed.replied("stream:1");
    expect(store.get()).toEqual({ text: "b", live: true });

    feed.replied("stream:2");
    expect(store.get()).toEqual({ text: "b", live: false });
  });

  it("a reply with no live cycle clears a finished text; full replaces the streamed text", () => {
    feed.reasoning("stream:1", "streamed");
    feed.replied("stream:1", "full text");
    expect(store.get()).toEqual({ text: "full text", live: false });

    feed.replied("stream:1");
    expect(store.get()).toEqual({ text: "", live: false });
  });
});

describe("turnFeed — sourceLost", () => {
  it("ends the slots a lost source's owners hold and leaves another source's cycle alone", () => {
    feed.reasoning("push:turn:8", "p");
    feed.toolStatus("push:turn:9", "running", "t");
    feed.reasoning("stream:3", "s");

    feed.sourceLost("push");

    expect(sink).toHaveBeenLastCalledWith({ state: "idle" });
    expect(store.get()).toEqual({ text: "s", live: true });
  });
});
