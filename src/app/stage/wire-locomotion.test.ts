import { beforeEach, describe, expect, it, vi } from "vitest";
import { avatarFixture } from "../../config/load-test-helpers";
import type { WindowRect } from "../../contract";
import type { DescentEdge } from "../../io/window/geometry/screen-geometry";

// The five loops, the travel frame, the sitter and the window sources are faked so each
// test can drive the deps wireLocomotion hands out and assert the composed handle.
const mocks = vi.hoisted(() => ({
  wireTravelFrame: vi.fn(),
  wireWalker: vi.fn(),
  wireStrollReflexCancel: vi.fn(),
  wireFaller: vi.fn(),
  wirePercher: vi.fn(),
  wireClimber: vi.fn(),
  createSitter: vi.fn(),
  wireWindowSources: vi.fn(),
}));

vi.mock("../../ambient/locomotion/wire", () => ({
  wireTravelFrame: mocks.wireTravelFrame,
  wireWalker: mocks.wireWalker,
  wireStrollReflexCancel: mocks.wireStrollReflexCancel,
  wireFaller: mocks.wireFaller,
  wirePercher: mocks.wirePercher,
  wireClimber: mocks.wireClimber,
}));

vi.mock("../../ambient/locomotion/sitter", () => ({ createSitter: mocks.createSitter }));

vi.mock("../turn/wire-sources", () => ({ wireWindowSources: mocks.wireWindowSources }));

import {
  createSitLossFall,
  descendConfigFor,
  fallConfigFor,
  wireLocomotion,
} from "./wire-locomotion";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe("wireLocomotion", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  const setup = () => {
    const cancelOrder: string[] = [];
    const teardowns: string[] = [];
    const registered: Array<() => void> = [];

    const travelFrame = {
      getWindow: vi.fn(),
      travel: { begin: vi.fn(), current: vi.fn(() => null) },
      abort: vi.fn(async () => {}),
      ready: Promise.resolve(),
      dispose: () => teardowns.push("travelFrame.dispose"),
    };
    const walker = {
      walkTo: vi.fn(async () => "arrived" as const),
      cancel: () => cancelOrder.push("walker.cancel"),
      isStrolling: vi.fn(() => false),
      dispose: () => teardowns.push("walker.dispose"),
    };
    const sitter = {
      start: vi.fn(),
      stop: () => teardowns.push("sitter.stop"),
      sitDown: vi.fn(async () => "done" as const),
      standUp: vi.fn(async () => "done" as const),
      cancel: () => cancelOrder.push("sitter.cancel"),
    };
    const faller = {
      drop: vi.fn(async () => {}),
      cancel: () => cancelOrder.push("faller.cancel"),
      dispose: () => teardowns.push("faller.dispose"),
    };
    const windowSources = {
      noteUserDrag: vi.fn(),
      noteUserDragEnd: vi.fn(),
      adoptSit: vi.fn(),
      armedSit: vi.fn(() => null),
      suspendSit: vi.fn(),
      resumeSit: vi.fn(),
      abandonSit: vi.fn(),
      release: vi.fn(),
      setKeepOnScreenPaused: vi.fn(),
      dispose: () => teardowns.push("windowSources.dispose"),
    };
    const percher = {
      cancel: () => cancelOrder.push("percher.cancel"),
      landOn: vi.fn(),
      dispose: () => teardowns.push("percher.dispose"),
    };
    const climber = {
      cancel: () => cancelOrder.push("climber.cancel"),
      descend: vi.fn(async () => {}),
      setEnabled: vi.fn(),
      dispose: () => teardowns.push("climber.dispose"),
    };

    let travelFrameDeps: { setKeepOnScreenPaused(paused: boolean): void } | undefined;
    let walkerDeps: { onDescend(edge: DescentEdge): void } | undefined;
    let fallerDeps: { onWindowLand(target: WindowRect): void } | undefined;
    mocks.wireTravelFrame.mockImplementation((deps) => {
      travelFrameDeps = deps;
      return travelFrame;
    });
    mocks.wireWalker.mockImplementation((deps) => {
      walkerDeps = deps;
      return walker;
    });
    mocks.wireStrollReflexCancel.mockImplementation(
      () => () => teardowns.push("stroll-reflex-cancel"),
    );
    mocks.createSitter.mockImplementation(() => sitter);
    mocks.wireFaller.mockImplementation((deps) => {
      fallerDeps = deps;
      return faller;
    });
    mocks.wireWindowSources.mockImplementation(() => windowSources);
    mocks.wirePercher.mockImplementation(() => percher);
    mocks.wireClimber.mockImplementation(() => climber);

    let climbEnabled = true;
    const climbSubscribers: Array<(state: { enabled: boolean }) => void> = [];
    const climbSettings = {
      get: () => ({ enabled: climbEnabled }),
      setEnabled: (enabled: boolean) => {
        climbEnabled = enabled;
        for (const notify of climbSubscribers) notify({ enabled });
      },
      reloadFromStorage: vi.fn(),
      subscribe: vi.fn((cb: (state: { enabled: boolean }) => void) => {
        climbSubscribers.push(cb);
        return () => teardowns.push("climbSettings.unsubscribe");
      }),
      dispose: vi.fn(),
    };

    const locomotion = wireLocomotion({
      bus: { push: vi.fn() } as never,
      renderer: {} as never,
      getConfig: () => ({}) as never,
      dispatcher: {} as never,
      hitTest: { setMoving: vi.fn() },
      peekActive: () => false,
      fallSettings: { get: () => ({ enabled: true }) } as never,
      climbSettings: climbSettings as never,
      agentNotifySettings: { get: () => ({ enabled: false, port: 8770 }) } as never,
      vrmSelection: { getActive: () => ({ id: "test", url: "/vrms/test.vrm" }) } as never,
      onStrollEnd: vi.fn(),
      register: (teardown: () => void) => {
        registered.push(teardown);
      },
      log: noopLog,
    });

    return {
      locomotion,
      travelFrameDeps: travelFrameDeps!,
      walkerDeps: walkerDeps!,
      fallerDeps: fallerDeps!,
      cancelOrder,
      teardowns,
      registered,
      climbSettings,
      walker,
      sitter,
      faller,
      windowSources,
      percher,
      climber,
      travelFrame,
    };
  };

  it("hands a faller window landing to the percher", () => {
    const s = setup();
    const target: WindowRect = {
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      name: "Test",
      ownerName: "Test",
      pid: 42,
      windowNumber: 7,
    };

    s.fallerDeps.onWindowLand(target);

    expect(s.percher.landOn).toHaveBeenCalledWith(target);
  });

  it("hands a walker descent to the climber", () => {
    const s = setup();
    const edge: DescentEdge = { side: "left", edgeX: 0, topY: 100, bottomY: 400 };

    s.walkerDeps.onDescend(edge);

    expect(s.climber.descend).toHaveBeenCalledWith(edge);
  });

  it("pauses the window sources' keep-on-screen guard while the travel frame parks", () => {
    const s = setup();

    s.travelFrameDeps.setKeepOnScreenPaused(true);
    expect(s.windowSources.setKeepOnScreenPaused).toHaveBeenCalledWith(true);

    s.travelFrameDeps.setKeepOnScreenPaused(false);
    expect(s.windowSources.setKeepOnScreenPaused).toHaveBeenLastCalledWith(false);
  });

  it("cancels walker, faller, climber, percher and sitter in that order", () => {
    const s = setup();

    s.locomotion.cancel();

    expect(s.cancelOrder).toEqual([
      "walker.cancel",
      "faller.cancel",
      "climber.cancel",
      "percher.cancel",
      "sitter.cancel",
    ]);
  });

  it("follows the climb toggle: the stored value at start and each later store change", () => {
    const s = setup();

    expect(s.climber.setEnabled).toHaveBeenCalledWith(true);

    s.climbSettings.setEnabled(false);
    expect(s.climber.setEnabled).toHaveBeenLastCalledWith(false);

    s.climbSettings.setEnabled(true);
    expect(s.climber.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it("registers the teardowns in composition order", () => {
    const s = setup();

    expect(s.registered).toHaveLength(9);
    for (const teardown of s.registered) teardown();

    expect(s.teardowns).toEqual([
      "travelFrame.dispose",
      "walker.dispose",
      "stroll-reflex-cancel",
      "sitter.stop",
      "faller.dispose",
      "windowSources.dispose",
      "percher.dispose",
      "climbSettings.unsubscribe",
      "climber.dispose",
    ]);
  });
});

describe("fallConfigFor", () => {
  const fall = { ...avatarFixture().fall, step_off_probability: 0.3 };

  it("passes the config through while the fall is on", () => {
    expect(fallConfigFor(fall, true)).toBe(fall);
  });

  it("never steps off the ledge while the fall is off", () => {
    expect(fallConfigFor(fall, false)).toEqual({ ...fall, step_off_probability: 0 });
  });
});

describe("descendConfigFor", () => {
  const descend = { chance: 0.5, climb_down_chance: 0.5 };

  it("passes the config through while the fall is on", () => {
    expect(descendConfigFor(descend, true)).toBe(descend);
  });

  it("always climbs down while the fall is off", () => {
    expect(descendConfigFor(descend, false)).toEqual({ ...descend, climb_down_chance: 1 });
  });
});

describe("createSitLossFall", () => {
  it("stops a running climb before handing the window to the fall", () => {
    const order: string[] = [];
    const climber = { cancel: () => order.push("climber.cancel") };
    const onSitLost = createSitLossFall({
      getClimber: () => climber,
      faller: {
        drop: async () => {
          order.push("faller.drop");
        },
      },
    });

    onSitLost();

    // A descent still inside its window survey would resume onto a falling window.
    expect(order).toEqual(["climber.cancel", "faller.drop"]);
  });

  it("falls when no climb is running", () => {
    const order: string[] = [];
    const onSitLost = createSitLossFall({
      getClimber: () => null,
      faller: {
        drop: async () => {
          order.push("faller.drop");
        },
      },
    });

    onSitLost();

    expect(order).toEqual(["faller.drop"]);
  });
});
