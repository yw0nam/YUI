import { describe, expect, it, vi } from "vitest";
import type { BedScene } from "../../ambient/bed-scene/bed-scene";
import { createBedSceneHold } from "./bed-scene-hold";
import { createAvatarBed } from "./create-avatar-bed";

type SceneState = ReturnType<BedScene["state"]>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(over: { scene?: "none"; reduced?: boolean; place?: () => Promise<boolean> } = {}) {
  const order: string[] = [];
  const hold = createBedSceneHold();
  let state: SceneState = "idle";
  let reduced = over.reduced ?? false;
  const scene = {
    state: () => state,
    lieDown: vi.fn<BedScene["lieDown"]>(async () => {
      order.push(`lieDown:held=${hold.isHeld()}`);
      state = "asleep";
      return "lying";
    }),
    wake: vi.fn(),
    cancel: vi.fn(),
    cancelStart: vi.fn(),
  };
  const place = vi.fn(
    over.place ??
      (async () => {
        order.push(`place:held=${hold.isHeld()}`);
        return true;
      }),
  );
  const renderer = {
    setPerchTarget: vi.fn((t: unknown) => order.push(`perch:${String(t)}:held=${hold.isHeld()}`)),
    setPeekTarget: vi.fn((t: unknown) => order.push(`peek:${String(t)}`)),
    setMotionMirror: vi.fn((on: boolean) => order.push(`mirror:${on}`)),
  };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const bed = createAvatarBed({
    hold,
    scene: () => (over.scene === "none" ? null : (scene as unknown as BedScene)),
    canRun: () => !reduced,
    place,
    renderer,
    log,
  });
  return {
    bed,
    hold,
    scene,
    place,
    order,
    log,
    setState: (next: SceneState) => {
      state = next;
    },
    setReduced: (next: boolean) => {
      reduced = next;
    },
  };
}

describe("createAvatarBed — phase", () => {
  it("reads the scene state: starting, lying and waking", () => {
    const h = setup();
    for (const [state, phase] of [
      ["starting", "starting"],
      ["asleep", "lying"],
      ["waking", "waking"],
    ] as const) {
      h.setState(state);
      expect(h.bed.phase()).toBe(phase);
    }
  });

  it("is off when no scene runs, and a finished scene still holding the window is starting", () => {
    const h = setup();
    expect(h.bed.phase()).toBe("off");
    h.setState("done");
    expect(h.bed.phase()).toBe("off");
    h.hold.take();
    expect(h.bed.phase()).toBe("starting");
  });

  it("is unsupported before the stage is wired or with reduced motion on, but the scene state wins while she lies", () => {
    expect(setup({ scene: "none" }).bed.phase()).toBe("unsupported");

    const h = setup();
    h.setReduced(true);
    expect(h.bed.phase()).toBe("unsupported");
    h.setState("asleep");
    expect(h.bed.phase()).toBe("lying");
    h.setState("waking");
    expect(h.bed.phase()).toBe("waking");
  });

  it("reports a launch hold as starting before any scene exists", () => {
    const h = setup({ scene: "none" });
    h.hold.take();
    expect(h.bed.phase()).toBe("starting");
  });
});

describe("createAvatarBed — lieDown", () => {
  it("clears the perch pins, then holds, places her and lies her down", async () => {
    const h = setup();

    expect(await h.bed.lieDown()).toEqual({ ok: true });
    expect(h.order).toEqual([
      "perch:null:held=false",
      "peek:null",
      "mirror:false",
      "place:held=true",
      "lieDown:held=true",
    ]);
    expect(h.hold.isHeld()).toBe(true);
  });

  it("answers unsupported without touching anything where no scene can run", async () => {
    for (const h of [setup({ scene: "none" }), setup({ reduced: true })]) {
      expect(await h.bed.lieDown()).toEqual({ ok: false, reason: "unsupported" });
      expect(h.order).toEqual([]);
      expect(h.hold.isHeld()).toBe(false);
    }
  });

  it("answers busy and lets go of the hold when the placement did not take", async () => {
    const h = setup({ place: async () => false });

    expect(await h.bed.lieDown()).toEqual({ ok: false, reason: "busy" });
    expect(h.scene.lieDown).not.toHaveBeenCalled();
    expect(h.hold.isHeld()).toBe(false);
  });

  it("answers unsupported and lets go of the hold when the placement throws", async () => {
    const h = setup({
      place: async () => {
        throw new Error("window gone");
      },
    });

    expect(await h.bed.lieDown()).toEqual({ ok: false, reason: "unsupported" });
    expect(h.scene.lieDown).not.toHaveBeenCalled();
    expect(h.hold.isHeld()).toBe(false);
    expect(h.log.warn).toHaveBeenCalled();
  });

  it("answers unsupported and lets go of the hold when a listener on the hold throws", async () => {
    const h = setup();
    h.hold.onTake(() => {
      throw new Error("listener");
    });

    expect(await h.bed.lieDown()).toEqual({ ok: false, reason: "unsupported" });
    expect(h.hold.isHeld()).toBe(false);
    expect(h.place).not.toHaveBeenCalled();
  });

  it("maps a scene that did not start: failed is unsupported, interrupted is interrupted", async () => {
    for (const [result, reason] of [
      ["failed", "unsupported"],
      ["interrupted", "interrupted"],
    ] as const) {
      const h = setup();
      h.scene.lieDown.mockResolvedValue(result);
      expect(await h.bed.lieDown()).toEqual({ ok: false, reason });
      // The scene's own exit lets go of the hold, after the window is back to its size.
      expect(h.hold.isHeld()).toBe(true);
    }
  });

  it("answers interrupted before the scene starts when a drag came during the placement", async () => {
    const placing = deferred<boolean>();
    const h = setup({ place: () => placing.promise });
    const lay = h.bed.lieDown();
    h.bed.interrupt();
    placing.resolve(true);

    expect(await lay).toEqual({ ok: false, reason: "interrupted" });
    expect(h.scene.lieDown).not.toHaveBeenCalled();
    expect(h.hold.isHeld()).toBe(false);
  });

  it("cancels a scene that is starting when a drag comes, and answers interrupted", async () => {
    const starting = deferred<"lying" | "interrupted" | "failed">();
    const h = setup();
    h.scene.lieDown.mockReturnValue(starting.promise);
    const lay = h.bed.lieDown();
    await vi.waitFor(() => expect(h.scene.lieDown).toHaveBeenCalled());
    h.bed.interrupt();
    expect(h.scene.cancelStart).toHaveBeenCalledOnce();
    starting.resolve("failed");

    expect(await lay).toEqual({ ok: false, reason: "interrupted" });
  });

  it("ignores an interrupt when no lie-down is in flight", async () => {
    const h = setup();
    h.bed.interrupt();
    expect(h.scene.cancelStart).not.toHaveBeenCalled();

    await h.bed.lieDown();
    h.bed.interrupt();
    expect(h.scene.cancelStart).not.toHaveBeenCalled();
  });
});

describe("createAvatarBed — getUp", () => {
  it("wakes a lying scene as the backend and cancels one that is still starting", () => {
    const h = setup();
    h.setState("asleep");
    h.bed.getUp();
    expect(h.scene.wake).toHaveBeenCalledWith("agent");
    expect(h.scene.cancel).not.toHaveBeenCalled();

    h.setState("starting");
    h.bed.getUp();
    expect(h.scene.cancel).toHaveBeenCalledOnce();
  });

  it("leaves a waking or absent scene alone", () => {
    const h = setup();
    h.setState("waking");
    h.bed.getUp();
    h.setState("idle");
    h.bed.getUp();
    expect(h.scene.wake).not.toHaveBeenCalled();
    expect(h.scene.cancel).not.toHaveBeenCalled();
    expect(() => setup({ scene: "none" }).bed.getUp()).not.toThrow();
  });

  it("wakes her even with reduced motion switched on while she lies", () => {
    const h = setup();
    h.setState("asleep");
    h.setReduced(true);
    h.bed.getUp();
    expect(h.scene.wake).toHaveBeenCalledWith("agent");
  });
});
