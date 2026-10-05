// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { avatarFixture } from "../../../config/load-test-helpers";
import type { EmotionRegistry, MotionRegistry } from "../../../contract";

const { load, resolveAssetUrl, createRenderer, rendererStub } = vi.hoisted(() => {
  const rendererStub = {
    playMotion: vi.fn(),
    setEmotion: vi.fn(),
    getCurrentMotion: vi.fn(() => null),
    setPerchTarget: vi.fn(),
    getPerchProbe: vi.fn(),
    loadVRM: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    load: vi.fn(),
    resolveAssetUrl: vi.fn(),
    rendererStub,
    createRenderer: vi.fn((_options: unknown) => rendererStub),
  };
});
vi.mock("../../../config/store", () => ({ createConfigStore: () => ({ load }) }));
vi.mock("../../../config/asset-url", () => ({ resolveAssetUrl }));
vi.mock("../../../renderer", () => ({ createRenderer }));

import { mountMotionPreview } from "./motion-preview";

const motions = {
  idle: {
    vrma_path: "/motions/idle_01.vrma",
    kind: "ambient",
    loop: true,
    priority: 10,
    interrupt_policy: "replace",
  },
  wave: {
    vrma_path: "/motions/wave.vrma",
    kind: "oneshot",
    loop: false,
    priority: 50,
    interrupt_policy: "replace",
  },
} satisfies MotionRegistry;
const emotionRegistry = {
  neutral: { vrm_expression: "neutral", fallback: "neutral" },
  happy: { vrm_expression: "happy", fallback: "neutral" },
} satisfies EmotionRegistry;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

describe("mountMotionPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ["__perch", "__perchProbe", "__yuiRenderer"]) {
      Reflect.deleteProperty(globalThis, key);
    }
    vi.clearAllMocks();
  });

  it("shows the controls before the config resolves, wires them after, and cancels the frame loop before disposing the renderer", async () => {
    const frames = new Map<number, () => void>();
    let nextFrameId = 1;
    const order: string[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      order.push("cancel");
      frames.delete(id);
    });
    rendererStub.dispose.mockImplementation(() => order.push("dispose"));
    const config = deferred<unknown>();
    const url = deferred<string>();
    const vrm = deferred<void>();
    load.mockReturnValue(config.promise);
    resolveAssetUrl.mockReturnValue(url.promise);
    rendererStub.loadVRM.mockReturnValue(vrm.promise);

    const mount = document.createElement("div");
    const mounted = mountMotionPreview(mount);
    const input = (id: string) => mount.querySelector<HTMLInputElement>(`#${id}`)!;
    const text = (id: string) => mount.querySelector(`#${id}`)?.textContent;

    // Before the config resolves: markup exists, the four readouts follow their sliders, nothing runs.
    type(input("sl-speed"), "1.5");
    type(input("sl-fade"), "340");
    type(input("sl-intensity"), "0.5");
    type(input("sl-transition"), "400");
    expect([
      text("val-speed"),
      text("val-fade"),
      text("val-intensity"),
      text("val-transition"),
    ]).toEqual(["1.5x", "340ms", "0.50", "400ms"]);
    expect(createRenderer).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);

    // After the config and the URL resolve, with loadVRM still pending.
    config.resolve({ motions, emotionRegistry, avatar: avatarFixture() });
    url.resolve("/vrms/test.vrm");
    await vi.waitFor(() => expect(rendererStub.loadVRM).toHaveBeenCalledWith("/vrms/test.vrm"));
    expect(frames.size).toBe(1);
    expect((globalThis as Record<string, unknown>).__perch).toBeTypeOf("function");
    let settled = false;
    void mounted.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // Renderer methods are looked up at call time, and the live slider values are read per click.
    const playMotion = vi.fn();
    const setEmotion = vi.fn();
    rendererStub.playMotion = playMotion;
    rendererStub.setEmotion = setEmotion;
    mount.querySelector<HTMLElement>('.motion-row[data-motion-id="wave"]')!.click();
    expect(playMotion).toHaveBeenCalledWith({ id: "wave", loop: true, speed: 1.5, fade_ms: 340 });
    mount.querySelector<HTMLElement>('.motion-row[data-emotion-id="happy"]')!.click();
    expect(setEmotion).toHaveBeenCalledWith({ id: "happy", intensity: 0.5, transition_ms: 400 });

    // Run one frame so the loop re-arms, then dispose.
    const [firstId, firstFrame] = [...frames][0];
    frames.delete(firstId);
    firstFrame();
    expect(frames.size).toBe(1);
    vrm.resolve();
    const handle = await mounted;
    handle.dispose();
    expect(order).toEqual(["cancel", "dispose"]);
    expect(frames.size).toBe(0);
  });
});
