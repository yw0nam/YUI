import { afterEach, describe, expect, it, vi } from "vitest";

// wire-walk reaches io/chat/stream/chat-client through dispatcher/backend/backend-caller; keep it mocked.
const { selectFetch } = vi.hoisted(() => ({ selectFetch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../io/chat/stream/chat-client", () => ({ selectFetch }));

const { createWalker, walkerStub } = vi.hoisted(() => {
  const walkerStub = {
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    isStrolling: vi.fn(() => false),
    walkTo: vi.fn(async () => "arrived" as const),
  };
  return { walkerStub, createWalker: vi.fn((_deps: Record<string, unknown>) => walkerStub) };
});
vi.mock("./walker", () => ({ createWalker }));
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []) }));

import type { Logger } from "../../../logger";
import type { TravelFrameHandle } from "../travel/wire-travel-frame";
import { wireStrollReflexCancel, wireWalker } from "./wire-walk";

describe("wireStrollReflexCancel", () => {
  function fakeDispatcher(trigger: string) {
    let cb: ((busy: boolean) => void) | null = null;
    const unsubscribe = vi.fn(() => {
      cb = null;
    });
    return {
      subscribeBusy: vi.fn((next: (busy: boolean) => void) => {
        cb = next;
        return unsubscribe;
      }),
      inFlight: () => ({
        trigger: { source: "tap", event_name: trigger, ts: 0, seq_id: 1 } as never,
        started_at: 0,
      }),
      fire: (busy: boolean) => cb?.(busy),
      unsubscribe,
    };
  }

  it("cancels a running stroll when a reflex turn opens", () => {
    const dispatcher = fakeDispatcher("proactive.touch_belly");
    const walker = { cancel: vi.fn() };
    const stop = wireStrollReflexCancel({ dispatcher, walker });
    dispatcher.fire(true);
    expect(walker.cancel).toHaveBeenCalledTimes(1);
    stop();
    expect(dispatcher.unsubscribe).toHaveBeenCalledTimes(1);
    dispatcher.fire(true);
    expect(walker.cancel).toHaveBeenCalledTimes(1);
  });

  it("leaves the stroll alone when an ordinary turn opens or a turn closes", () => {
    const dispatcher = fakeDispatcher("user.text_submitted");
    const walker = { cancel: vi.fn() };
    wireStrollReflexCancel({ dispatcher, walker });
    dispatcher.fire(true);
    dispatcher.fire(false);
    expect(walker.cancel).not.toHaveBeenCalled();
  });
});

const noopLog: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// readRead resolves after the dynamic imports reach the readiness await.
function startWalker() {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  createWalker.mockClear();
  walkerStub.start.mockClear();
  walkerStub.stop.mockClear();
  const readRead = deferred();
  const ready = deferred();
  const travelFrame: TravelFrameHandle = {
    getWindow: () => ({}) as never,
    travel: {} as never,
    abort: async () => {},
    dispose: () => {},
    get ready() {
      readRead.resolve();
      return ready.promise;
    },
  };
  const handle = wireWalker({
    bus: {} as never,
    renderer: {} as never,
    travelFrame,
    getWalkConfig: () => ({}) as never,
    getDescendConfig: () => ({}) as never,
    getMotionKind: () => undefined,
    isPeeking: () => false,
    isDragging: () => false,
    setHitTestMoving: () => {},
    onStrollEnd: () => {},
    onDescend: () => {},
    log: noopLog,
  });
  return { handle, readRead, ready };
}

describe("wireWalker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds and starts the walker once the travel frame is ready, and stops it on dispose", async () => {
    const { handle, readRead, ready } = startWalker();
    await readRead.promise;
    expect(createWalker).not.toHaveBeenCalled();
    ready.resolve();
    await vi.waitFor(() => expect(walkerStub.start).toHaveBeenCalledTimes(1));
    expect(createWalker).toHaveBeenCalledTimes(1);
    handle.dispose();
    expect(walkerStub.stop).toHaveBeenCalledTimes(1);
  });

  it("never builds the walker when disposed before the travel frame is ready", async () => {
    const { handle, readRead, ready } = startWalker();
    await readRead.promise;
    handle.dispose();
    ready.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createWalker).not.toHaveBeenCalled();
  });
});
