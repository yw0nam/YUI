// @vitest-environment jsdom
/**
 * quick-controls.tts-line-open.test.ts — opening the panel on the Connection page, with the
 * open's voice list refresh in flight, shows the TTS line Connected: the line's own check reads
 * the endpoints after the refresh started, so its answer is the one that lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../../contract";
import { createTtsServerCheck } from "../../io/voice/voices/tts-server-check";
import { createVoiceListRefresh } from "../../io/voice/voices/voice-list-refresh";
import type { Logger } from "../../logger";
import { setLocale, t } from "../i18n";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./test-helpers";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const log: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe("createQuickControls — the TTS line on open", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("opening on the Connection page leaves the TTS line showing the server the refresh reached", async () => {
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: "aoi" }] }), { status: 200 }),
      )) as typeof fetch);
    const args = defaultQcArgs(mount);
    args.endpointsSettings.set({ tts_provider: "irodori", tts_base_url: "http://127.0.0.1:8088" });
    const getEndpoints = () => args.endpointsSettings.get() as unknown as EndpointsConfig;
    const refreshVoiceList = createVoiceListRefresh({
      getEndpoints,
      getApiKey: async () => undefined,
      speakerSelection: args.speakerSelection,
      log,
    });
    const qc = createQuickControls({
      ...args,
      refreshVoiceList,
      getEndpoints,
      checkTtsServer: createTtsServerCheck({
        getEndpoints,
        getApiKey: async () => undefined,
        refreshVoiceList,
      }),
    });

    qc.open({ tab: "conn" });
    for (let i = 0; i < 5; i += 1) await tick();

    const line = qc.el.querySelector<HTMLElement>('[data-svc="tts"] .yui-chat-status');
    expect(line?.hidden).toBe(false);
    expect(line!.textContent).toContain(t("svc.server_connected", { host: "127.0.0.1:8088" }));

    qc.dispose();
  });
});
