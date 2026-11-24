// @vitest-environment jsdom

import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avatarFixture } from "../../../config/load-test-helpers";
import type { AvatarConfig } from "../../../config/validators/avatar/types";
import type { EmotionRegistry, MotionRegistry } from "../../../contract";
import { createContextHistory } from "../../../io/chat/conversation/context-history";
import { createEndpointsSettings } from "../../../settings/backend/endpoints-settings";
import { createDevtoolsShell } from "../shell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { load, resolveAssetUrl, createRenderer, rendererStub } = vi.hoisted(() => {
  const rendererStub = {
    playMotion: vi.fn(),
    setEmotion: vi.fn(),
    getCurrentMotion: vi.fn<() => { id: string; vrma_path: string } | null>(() => null),
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

/** Frames the stubbed requestAnimationFrame holds; Base UI's scheduler requests some too. */
let frames: Map<number, () => void>;

/** Runs every pending frame once; a frame that re-arms lands in the next run. */
function runFrames(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb();
}

let shell: ReturnType<typeof createDevtoolsShell> | null = null;

/** The devtools window with the real preview core behind its Motion panel. */
function mountShell() {
  document.body.innerHTML = '<div id="app"></div>';
  const created = createDevtoolsShell({
    mount: document.querySelector("#app")!,
    history: createContextHistory(),
    endpointsSettings: createEndpointsSettings(),
    loadMotionPreview: mountMotionPreview,
  });
  shell = created;
  return created;
}

/** The row button named `name`, asserted to be the only button of its list item in a list. */
function onlyButtonIn(name: RegExp): HTMLElement {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  const item = button?.closest("li");
  expect(item?.parentElement?.tagName).toBe("UL");
  expect(item ? within(item).queryAllByRole("button") : []).toEqual([button]);
  return button!;
}

describe("mountMotionPreview", () => {
  beforeEach(() => {
    frames = new Map();
    let nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => {
    act(() => shell?.dispose());
    shell = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    for (const key of ["__perch", "__perchProbe", "__yuiRenderer"]) {
      Reflect.deleteProperty(globalThis, key);
    }
    vi.clearAllMocks();
  });

  it("shows the controls before the config resolves, wires them after, and cancels the frame loop before disposing the renderer", async () => {
    const reads = () => rendererStub.getCurrentMotion.mock.calls.length;
    let readsAfterDispose = -1;
    rendererStub.dispose.mockImplementation(() => {
      const before = reads();
      runFrames();
      readsAfterDispose = reads() - before;
    });
    const config = deferred<unknown>();
    const url = deferred<string>();
    const vrm = deferred<void>();
    load.mockReturnValue(config.promise);
    resolveAssetUrl.mockReturnValue(url.promise);
    rendererStub.loadVRM.mockReturnValue(vrm.promise);

    const shell = mountShell();
    let settled = false;
    act(() => {
      void shell.activate("motion").then(() => {
        settled = true;
      });
    });
    const slide = (name: string, value: string) =>
      fireEvent.change(screen.getByRole("slider", { name }), { target: { value } });

    // Before the config resolves: the four readouts follow their sliders, nothing runs.
    slide("speed", "1.5");
    slide("fade", "340");
    slide("intensity", "0.5");
    slide("transition", "400");
    expect([...document.querySelectorAll(".slider-value")].map((v) => v.textContent)).toEqual([
      "1.5x",
      "340ms",
      "0.50",
      "400ms",
    ]);
    expect(createRenderer).not.toHaveBeenCalled();

    // After the config and the URL resolve, with loadVRM still pending.
    await act(async () => {
      config.resolve({ motions, emotionRegistry, avatar: avatarFixture() });
      url.resolve("/vrms/test.vrm");
    });
    await vi.waitFor(() => expect(rendererStub.loadVRM).toHaveBeenCalledWith("/vrms/test.vrm"));
    expect((globalThis as Record<string, unknown>).__perch).toBeTypeOf("function");
    expect(settled).toBe(false);

    // Renderer methods are looked up at call time, and the live slider values are read per click.
    const playMotion = vi.fn();
    const setEmotion = vi.fn();
    rendererStub.playMotion = playMotion;
    rendererStub.setEmotion = setEmotion;
    fireEvent.click(onlyButtonIn(/^wave/));
    expect(playMotion).toHaveBeenCalledWith({ id: "wave", loop: true, speed: 1.5, fade_ms: 340 });
    fireEvent.click(onlyButtonIn(/^happy/));
    expect(setEmotion).toHaveBeenCalledWith({ id: "happy", intensity: 0.5, transition_ms: 400 });

    // The frame loop reads the renderer once per frame and re-arms; it stops before the renderer is disposed.
    act(() => runFrames());
    act(() => runFrames());
    expect(reads()).toBe(2);
    await act(async () => vrm.resolve());
    expect(settled).toBe(true);
    act(() => shell.dispose());
    expect(rendererStub.dispose).toHaveBeenCalledOnce();
    expect(readsAfterDispose).toBe(0);
  });

  it("plays a motion and sets an emotion from a row that is the only button in its list item", async () => {
    load.mockResolvedValue({ motions, emotionRegistry, avatar: avatarFixture() });
    resolveAssetUrl.mockResolvedValue("/vrms/test.vrm");
    rendererStub.loadVRM.mockResolvedValue(undefined);
    const shell = mountShell();
    await act(() => shell.activate("motion"));

    fireEvent.click(onlyButtonIn(/^wave/));
    expect(rendererStub.playMotion).toHaveBeenCalledWith({
      id: "wave",
      loop: true,
      speed: 1,
      fade_ms: 200,
    });
    fireEvent.click(onlyButtonIn(/^happy/));
    expect(rendererStub.setEmotion).toHaveBeenCalledWith({
      id: "happy",
      intensity: 1,
      transition_ms: 250,
    });
  });

  it("renders a markup-bearing variant filename in the idle sub-line as text", async () => {
    const markupPath = "/motions/<img src=x onerror=alert(1)>.vrma";
    const idle = {
      ...motions.idle,
      variants: ["/motions/idle_01.vrma", markupPath],
    } satisfies MotionRegistry[string];
    load.mockResolvedValue({ motions: { idle }, emotionRegistry, avatar: avatarFixture() });
    resolveAssetUrl.mockResolvedValue("/vrms/test.vrm");
    rendererStub.loadVRM.mockResolvedValue(undefined);
    rendererStub.getCurrentMotion.mockReturnValue({ id: "idle", vrma_path: markupPath });
    const shell = mountShell();
    await act(() => shell.activate("motion"));

    act(() => runFrames());

    const subLine = document.querySelector(".sub-line")!;
    expect(subLine.querySelector("img")).toBeNull();
    expect(subLine.textContent).toBe("variant 2/2 · <img src=x onerror=alert(1)>");
    expect(subLine.querySelector("span")?.textContent).toBe("2/2");
    expect(onlyButtonIn(/^idle(?!_)/).classList.contains("state-playing")).toBe(true);
  });

  describe("with a stored VRM selection", () => {
    afterEach(() => localStorage.removeItem("yui.vrm"));

    it("loads the selected option's url instead of the configured default", async () => {
      localStorage.setItem("yui.vrm", "shino");
      const avatar = {
        ...avatarFixture(),
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
          { id: "shino", label: "Shino", url: "/vrms/shino.vrm", source: "bundled" },
        ],
      } satisfies AvatarConfig;
      load.mockResolvedValue({ motions, emotionRegistry, avatar });
      resolveAssetUrl.mockImplementation(async (url: string) => `resolved:${url}`);
      rendererStub.loadVRM.mockResolvedValue(undefined);

      await act(() => mountShell().activate("motion"));

      expect(rendererStub.loadVRM).toHaveBeenCalledWith("resolved:/vrms/shino.vrm");
    });
  });
});
