// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockDriver, createMockDriver } = vi.hoisted(() => {
  const mockDriver = { reply: vi.fn(), proactive: vi.fn(), speak: vi.fn() };
  return { mockDriver, createMockDriver: vi.fn(() => mockDriver) };
});

vi.mock("../../ui/surfaces/mock", () => ({ createMockDriver }));

import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { wireDevGlobals } from "./wire-dev-globals";

describe("wireDevGlobals", () => {
  afterEach(() => {
    for (const key of [
      "__yuiRenderer",
      "__yuiAmbient",
      "__yuiSurfaces",
      "__yuiMock",
      "__yuiScreenshot",
      "__yuiLipsync",
      "__yuiAgent",
      "__yuiQuick",
      "__yuiSpeech",
      "__yuiVoiceInputStatus",
      "__yui_send",
      "__yui_dispatcher",
      "__yui_windowSit",
      "__yuiDemo",
    ]) {
      delete (globalThis as Record<string, unknown>)[key];
    }
    createMockDriver.mockClear();
  });

  const quickCardWindow = { open: vi.fn() };
  const makeDeps = () => {
    const dispatcher = { id: "dispatcher" };
    return {
      renderer: {
        id: "renderer",
        getCharacterAnchor: vi.fn(() => ({ x: 200, y: 300 })),
        getCharacterWidthPx: vi.fn(() => 100),
      },
      ambient: { trigger: vi.fn() },
      surfaces: { summonInput: vi.fn(), showTool: vi.fn() },
      screenshotSettings: { id: "screenshot" },
      lipsyncSettings: { id: "lipsync" },
      agentSettings: { id: "agent" },
      quickCardWindow,
      boundId: null as string | null,
      speechPlayback: { id: "speech" },
      voiceInputStatus: createVoiceInputStatus(),
      userInput: { submit: vi.fn() },
      bus: { push: vi.fn() },
      getDispatcher: () => dispatcher,
      sitDown: vi.fn(async () => "done" as const),
    };
  };

  it("installs debug globals referencing the live instances", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const g = globalThis as Record<string, unknown>;
    expect(g.__yuiRenderer).toBe(deps.renderer);
    expect(g.__yuiSurfaces).toBe(deps.surfaces);
    expect(g.__yuiMock).toBe(mockDriver);
    expect((g.__yui_dispatcher as () => unknown)()).toEqual({ id: "dispatcher" });
  });

  it("publishes the supplied speech playback as __yuiSpeech", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const g = globalThis as Record<string, unknown>;
    expect(g.__yuiSpeech).toBe(deps.speechPlayback);
  });

  it.each([
    [
      "main's",
      null,
      [
        [{ left: 150, right: 250, y: 60, listening: false }],
        [{ left: 150, right: 250, y: 384, listening: true }],
      ],
    ],
    [
      "a bound character's",
      "a",
      [[{ left: 150, right: 250, y: 60 }], [{ left: 150, right: 250, y: 384 }]],
    ],
  ])("__yuiQuick opens %s quick-card window at a point or the window's centre; only main's names listening", async (_name, boundId, calls) => {
    const deps = { ...makeDeps(), boundId };
    await wireDevGlobals(deps as never);
    const quick = (globalThis as Record<string, unknown>).__yuiQuick as {
      open(at?: { x: number; y: number }): void;
    };

    quick.open({ x: 40, y: 60 });
    deps.voiceInputStatus.set("listening");
    quick.open();

    // jsdom's window is 1024×768, so its centre is at y 384.
    expect(quickCardWindow.open.mock.calls).toEqual(calls);
  });

  it("__yui_send submits text through userInput", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    (globalThis as unknown as Record<string, (text: string) => void>).__yui_send("hello");
    expect(deps.userInput.submit).toHaveBeenCalledWith("hello");
  });

  it("__yui_windowSit.enter plays the sit-down, then pushes a window_sit_enter event", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const windowSit = (globalThis as unknown as Record<string, { enter: () => void }>)
      .__yui_windowSit;
    windowSit.enter();
    expect(deps.sitDown).toHaveBeenCalledTimes(1);
    expect(deps.bus.push).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(deps.bus.push).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: "user.window_sit_enter" }),
    );
  });

  it("__yui_windowSit.enter pushes nothing when the sit-down is lost", async () => {
    const deps = makeDeps();
    deps.sitDown.mockResolvedValue("lost" as never);
    await wireDevGlobals(deps as never);
    const windowSit = (globalThis as unknown as Record<string, { enter: () => void }>)
      .__yui_windowSit;
    windowSit.enter();
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.bus.push).not.toHaveBeenCalled();
  });
});
