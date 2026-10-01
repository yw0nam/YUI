/**
 * voice-controller.test.ts — the phone's capture intent: tap toggle and keep-listening modes over
 * the foreground, the STT setting, and the mic failures the engine reports.
 */

import { describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../../../contract";
import type { PageVisibility } from "../../../io/lifecycle/page-visibility";
import { createVoiceMode, type VoiceMode } from "../../../settings/voice/voice-mode";
import { createVoiceInputStatus } from "../../../ui/chips/voice-input-status";
import { createVoiceController } from "./voice-controller";

function setup(opts: { mode?: VoiceMode; stt?: string; hidden?: boolean; started?: boolean } = {}) {
  const status = createVoiceInputStatus();
  const mode = createVoiceMode({
    storage: { load: () => ({ mode: opts.mode ?? "tap" }), save: () => {} },
  });
  let hidden = opts.hidden ?? false;
  const listeners = new Set<() => void>();
  const visibility: PageVisibility = {
    get: () => hidden,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose: () => listeners.clear(),
  };
  const endpoints = { stt_base_url: opts.stt ?? "http://stt" } as EndpointsConfig;
  const openSttSettings = vi.fn();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const controller = createVoiceController({
    status,
    mode,
    visibility,
    getEndpoints: () => {
      if (opts.started === false) throw new Error("config not loaded");
      return endpoints;
    },
    openSttSettings,
    log,
  });
  if (opts.started !== false) controller.start();
  return {
    status,
    mode,
    controller,
    endpoints,
    openSttSettings,
    log,
    setHidden(next: boolean): void {
      hidden = next;
      for (const cb of [...listeners]) cb();
    },
  };
}

describe("voice controller — STT not configured", () => {
  it("opens the STT settings on a toggle and never listens", () => {
    const s = setup({ stt: "" });

    s.controller.toggle();

    expect(s.openSttSettings).toHaveBeenCalledTimes(1);
    expect(s.controller.wanted()).toBe(false);
    expect(s.status.get().state).toBe("idle");
  });

  it("opens the STT settings on selecting keep listening and leaves the mode on tap", () => {
    const s = setup({ stt: "" });

    s.controller.selectMode("always");
    s.controller.onCaptureStarted();

    expect(s.openSttSettings).toHaveBeenCalledTimes(1);
    expect(s.mode.get().mode).toBe("tap");
    expect(s.status.get().state).toBe("idle");
  });

  it("stays silent on launch and foreground return in a saved always mode", () => {
    const s = setup({ mode: "always", stt: "" });
    s.setHidden(true);
    s.setHidden(false);

    expect(s.status.get().state).toBe("idle");
    expect(s.openSttSettings).not.toHaveBeenCalled();
  });

  it("does not start listening when a URL is added later", () => {
    const s = setup({ mode: "always", stt: "" });

    s.endpoints.stt_base_url = "http://stt";

    expect(s.status.get().state).toBe("idle");
    expect(s.controller.wanted()).toBe(false);
  });
});

describe("voice controller — tap mode", () => {
  it("is off on launch", () => {
    const s = setup();
    expect(s.controller.wanted()).toBe(false);
    expect(s.status.get().state).toBe("idle");
  });

  it("toggles listening on and off", () => {
    const s = setup();

    s.controller.toggle();
    expect(s.controller.wanted()).toBe(true);
    expect(s.status.get().state).toBe("listening");

    s.controller.toggle();
    expect(s.controller.wanted()).toBe(false);
    expect(s.status.get().state).toBe("idle");
  });

  it("goes off in the background and stays off on return", () => {
    const s = setup();
    s.controller.toggle();
    s.controller.onCaptureStarted();

    s.setHidden(true);
    expect(s.controller.wanted()).toBe(false);
    expect(s.status.get().state).toBe("idle");

    s.setHidden(false);
    expect(s.controller.wanted()).toBe(false);
    expect(s.status.get().state).toBe("idle");
  });

  it("never listens on a launch into the background", () => {
    const s = setup({ hidden: true });
    expect(s.status.get().state).toBe("idle");
  });
});

describe("voice controller — always mode", () => {
  it("listens on a visible launch", () => {
    const s = setup({ mode: "always" });
    expect(s.controller.wanted()).toBe(true);
    expect(s.status.get().state).toBe("listening");
  });

  it("waits for the foreground when it launches hidden", () => {
    const s = setup({ mode: "always", hidden: true });
    expect(s.status.get().state).toBe("idle");

    s.setHidden(false);
    expect(s.status.get().state).toBe("listening");
  });

  it("stops in the background and listens again on every return", () => {
    const s = setup({ mode: "always" });
    s.controller.onCaptureStarted();

    s.setHidden(true);
    expect(s.status.get().state).toBe("idle");
    s.setHidden(false);
    expect(s.status.get().state).toBe("listening");
    s.controller.onCaptureStarted();
    s.setHidden(true);
    s.setHidden(false);
    expect(s.controller.wanted()).toBe(true);
  });

  it("keeps a starting capture through the background change a permission prompt causes", () => {
    const s = setup();
    s.controller.toggle();

    s.setHidden(true);
    expect(s.controller.wanted()).toBe(true);
    s.setHidden(false);
    s.controller.onCaptureStarted();

    expect(s.controller.wanted()).toBe(true);
    expect(s.status.get().state).toBe("listening");
  });

  it("turns a capture off that starts while the app is still in the background", () => {
    const s = setup();
    s.controller.toggle();
    s.setHidden(true);

    s.controller.onCaptureStarted();

    expect(s.controller.wanted()).toBe(false);
    expect(s.status.get().state).toBe("idle");
  });

  it("pauses on a toggle for this foreground session and resumes on the next return", () => {
    const s = setup({ mode: "always" });

    s.controller.toggle();
    expect(s.controller.wanted()).toBe(false);
    expect(s.status.get().state).toBe("idle");
    expect(s.mode.get().mode).toBe("always");

    s.setHidden(true);
    s.setHidden(false);
    expect(s.controller.wanted()).toBe(true);
  });

  it("ignores foreground changes before start()", () => {
    const s = setup({ mode: "always", started: false });
    s.setHidden(true);
    s.setHidden(false);
    expect(s.status.get().state).toBe("idle");
  });
});

describe("voice controller — selecting keep listening", () => {
  it("turns listening on at once and saves the mode only after the capture starts", () => {
    const s = setup();

    s.controller.selectMode("always");
    expect(s.controller.wanted()).toBe(true);
    expect(s.status.get().state).toBe("listening");
    expect(s.mode.get().mode).toBe("tap");

    s.controller.onCaptureStarted();
    expect(s.mode.get().mode).toBe("always");
  });

  it("saves the mode at once when a tap-mode capture already runs", () => {
    const s = setup();
    s.controller.toggle();
    s.controller.onCaptureStarted();

    s.controller.selectMode("always");

    expect(s.mode.get().mode).toBe("always");
    expect(s.controller.wanted()).toBe(true);
  });

  it("leaves the mode on tap when the capture fails to start", () => {
    const s = setup();
    s.controller.selectMode("always");

    s.status.set("error", "mic_denied");
    s.controller.onCaptureFailed();
    s.controller.onCaptureStarted();

    expect(s.mode.get().mode).toBe("tap");
    expect(s.controller.wanted()).toBe(false);
  });

  it("selecting tap saves it and turns listening off", () => {
    const s = setup({ mode: "always" });

    s.controller.selectMode("tap");

    expect(s.mode.get().mode).toBe("tap");
    expect(s.controller.wanted()).toBe(false);
    expect(s.status.get().state).toBe("idle");
  });

  it("does not save always after the selection was turned off before the capture started", () => {
    const s = setup();
    s.controller.selectMode("always");
    s.controller.toggle();

    s.controller.onCaptureStarted();

    expect(s.mode.get().mode).toBe("tap");
  });
});

describe("voice controller — mic failures", () => {
  it.each([
    "mic_denied",
    "no_mic",
    "mic_unavailable",
  ])("turns intent off on a failed start (%s) and keeps the error on the status", (code) => {
    const s = setup();
    s.controller.toggle();

    s.status.set("error", code);
    s.controller.onCaptureFailed();

    expect(s.controller.wanted()).toBe(false);
    expect(s.status.get()).toMatchObject({ state: "error", detail: code });
  });

  it("retries on the next single toggle and never by itself", () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      s.controller.toggle();
      s.status.set("error", "mic_denied");
      s.controller.onCaptureFailed();

      vi.advanceTimersByTime(120_000);
      expect(s.status.get().state).toBe("error");

      s.controller.toggle();
      expect(s.controller.wanted()).toBe(true);
      expect(s.status.get().state).toBe("listening");
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns intent off on a failed start whatever the detail says", () => {
    const s = setup();
    s.controller.toggle();

    s.status.set("error", "Voice init failed: worklet failed");
    s.controller.onCaptureFailed();

    expect(s.controller.wanted()).toBe(false);
  });

  it("keeps intent on for a status error that is not a failed start", () => {
    const s = setup();
    s.controller.toggle();

    s.status.set("error", "HTTP 500");

    expect(s.controller.wanted()).toBe(true);
  });

  it("does not listen again after a failure until the next return in always mode", () => {
    const s = setup({ mode: "always" });
    s.status.set("error", "mic_denied");
    s.controller.onCaptureFailed();
    expect(s.controller.wanted()).toBe(false);

    s.setHidden(true);
    s.setHidden(false);

    expect(s.controller.wanted()).toBe(true);
  });
});

describe("voice controller — before start()", () => {
  it("toggle and selectMode do nothing before the config has loaded", () => {
    const s = setup({ started: false });
    expect(() => {
      s.controller.toggle();
      s.controller.selectMode("always");
    }).not.toThrow();

    expect(s.controller.wanted()).toBe(false);
    expect(s.openSttSettings).not.toHaveBeenCalled();
  });
});

describe("voice controller — re-selecting the checked mode", () => {
  it("keeps listening when tap is selected again in tap mode", () => {
    const s = setup();
    s.controller.toggle();
    s.controller.onCaptureStarted();

    s.controller.selectMode("tap");

    expect(s.controller.wanted()).toBe(true);
    expect(s.status.get().state).toBe("listening");
  });

  it("changes nothing when always is selected again in always mode", () => {
    const s = setup({ mode: "always" });
    s.controller.toggle();

    s.controller.selectMode("always");

    expect(s.controller.wanted()).toBe(false);
  });
});

describe("voice controller — observers", () => {
  it("notifies on intent and on status changes and reports live", () => {
    const s = setup();
    const seen: boolean[] = [];
    s.controller.subscribe(() => seen.push(s.controller.live()));

    s.controller.toggle();
    expect(seen.at(-1)).toBe(true);

    s.status.set("error", "HTTP 500");
    expect(seen.at(-1)).toBe(false);
    expect(s.controller.wanted()).toBe(true);
    expect(s.controller.live()).toBe(false);
  });

  it("stops reacting after dispose", () => {
    const s = setup({ mode: "always" });
    const cb = vi.fn();
    s.controller.subscribe(cb);

    s.controller.dispose();
    s.setHidden(true);

    expect(cb).not.toHaveBeenCalled();
    expect(s.status.get().state).toBe("listening");
  });
});
