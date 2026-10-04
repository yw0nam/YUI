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

  const makeDeps = () => {
    const dispatcher = { id: "dispatcher" };
    return {
      renderer: { id: "renderer" },
      ambient: { trigger: vi.fn() },
      surfaces: { summonInput: vi.fn(), showTool: vi.fn() },
      screenshotSettings: { id: "screenshot" },
      lipsyncSettings: { id: "lipsync" },
      agentSettings: { id: "agent" },
      quickControls: { id: "quick" },
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
    expect(g.__yuiQuick).toBe(deps.quickControls);
    expect((g.__yui_dispatcher as () => unknown)()).toEqual({ id: "dispatcher" });
  });

  it("publishes the supplied speech playback as __yuiSpeech and keeps quick controls by value", async () => {
    const deps = makeDeps();
    await wireDevGlobals(deps as never);
    const g = globalThis as Record<string, unknown>;
    expect(g.__yuiSpeech).toBe(deps.speechPlayback);
    expect(g.__yuiQuick).toBe(deps.quickControls);
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
