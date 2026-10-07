import { afterEach, describe, expect, it, vi } from "vitest";

const { createClimber, climberStub } = vi.hoisted(() => {
  const climberStub = {
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    descend: vi.fn(async () => {}),
    setEnabled: vi.fn(),
  };
  return { climberStub, createClimber: vi.fn((_deps: Record<string, unknown>) => climberStub) };
});
vi.mock("./climber", () => ({ createClimber }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []) }));

import type { Logger } from "../../../logger";
import type { TravelFrameHandle } from "../travel/wire-travel-frame";
import { wireClimber } from "./wire-climb";

const noopLog: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// readRead resolves after the dynamic imports reach the readiness await.
function startClimber() {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  createClimber.mockClear();
  for (const fn of Object.values(climberStub)) fn.mockClear();
  const readRead = deferred();
  const ready = deferred();
  const travelFrame: TravelFrameHandle = {
    getWindow: () => ({}) as never,
    frameWindow: () => ({}) as never,
    travel: {} as never,
    abort: async () => {},
    dispose: () => {},
    get ready() {
      readRead.resolve();
      return ready.promise;
    },
  };
  const handle = wireClimber({
    bus: {} as never,
    renderer: {} as never,
    travelFrame,
    getClimbConfig: () => ({}) as never,
    getDescendConfig: () => ({}) as never,
    getFallConfig: () => ({}) as never,
    getWalkConfig: () => ({}) as never,
    getMotionKind: () => undefined,
    isPeeking: () => false,
    isDragging: () => false,
    isBusy: () => false,
    walker: {} as never,
    faller: {} as never,
    sitter: {} as never,
    dropSource: {} as never,
    setHitTestMoving: () => {},
    log: noopLog,
  });
  return { handle, readRead, ready };
}

describe("wireClimber", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("latches a disable made before the travel frame is ready, then forwards toggles until dispose", async () => {
    const { handle, readRead, ready } = startClimber();
    handle.setEnabled(false);
    await readRead.promise;
    ready.resolve();
    await vi.waitFor(() => expect(createClimber).toHaveBeenCalledTimes(1));
    expect(climberStub.start).not.toHaveBeenCalled();
    handle.setEnabled(true);
    expect(climberStub.setEnabled).toHaveBeenCalledTimes(1);
    expect(climberStub.setEnabled).toHaveBeenLastCalledWith(true);
    handle.dispose();
    expect(climberStub.stop).toHaveBeenCalledTimes(1);
    handle.setEnabled(false);
    expect(climberStub.setEnabled).toHaveBeenCalledTimes(1);
  });

  it("never builds the climber when disposed before the travel frame is ready", async () => {
    const { handle, readRead, ready } = startClimber();
    await readRead.promise;
    handle.dispose();
    ready.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createClimber).not.toHaveBeenCalled();
  });
});
