// @vitest-environment jsdom
/**
 * voice-step.test.ts — Quick start's voice section.
 *
 * reflect: an empty effective TTS URL shows the step, a configured one shows the configured line,
 * and a missing default-voice table hides the section. Turning on: an empty key asks for one, an
 * accepted key writes the Fish provider, the key and TTS on, and makes the language's default
 * voice active; a refused or failed check writes nothing. A completion after dispose or after
 * Maybe later writes nothing.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsProviderName } from "../../../../contract";
import { createSpeakerSelection } from "../../../../io/voice/voices/speaker-selection";
import {
  createVoiceListRefresh,
  wireVoiceListAutoRefresh,
} from "../../../../io/voice/voices/voice-list-refresh";
import { createTtsKeySettings } from "../../../../settings/backend/api-key-settings";
import { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { type Locale, setLocale } from "../../../i18n";
import { inMemoryApiKeyStorage } from "../../test-helpers";
import { createVoiceStep } from "./voice-step";

const VOICES = {
  en: { id: "c2536221a1c141ceae2d11fe15503858", name: "Shinobu" },
  ja: { id: "d1a1a920956c40c0bac4ef6a92c92a20", name: "Tokai Teio" },
  ko: { id: "79a8364e57844ba5a463dbf3d29ce99c", name: "Sylvia" },
};
const IRODORI_VOICE_ID = "irodori-tts";
// The account's one own model, as Fish's /model?self=true lists it.
const OWN_MODEL = { _id: "5f0c1e7a9b2d4c6e8a1b3d5f7e9c2a4b", title: "My voice" };
const REFUSED = "Fish Audio did not accept this key. Paste the key you copied again.";
const FAILED = "Could not reach Fish Audio. Check your internet connection and try again.";
const IS_ON: Record<Locale, string> = {
  en: "Voice is on. The default voice is Shinobu.",
  ja: "音声をオンにしました。標準の声は Tokai Teio です。",
  ko: "음성을 켰습니다. 기본 목소리는 Sylvia입니다.",
};

// The voice-list refresh outside Tauri falls back to the global fetch, and may run past its test.
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ total: 1, has_more: false, items: [OWN_MODEL] }), {
        status: 200,
      }),
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function setup(
  fetchImpl: typeof globalThis.fetch = async () =>
    new Response(JSON.stringify({ items: [] }), { status: 200 }),
  opts: { getDefaultVoices?: () => typeof VOICES | undefined } = {},
) {
  const fetchMock = vi.fn(fetchImpl);
  const endpointsSettings = createEndpointsSettings();
  const ttsKeySettings = createTtsKeySettings({ storage: inMemoryApiKeyStorage() });
  const ttsSettings = createFlagSettings(false);
  const speakerSelection = createSpeakerSelection({
    available: [{ id: IRODORI_VOICE_ID, label: "Irodori", ref_url: "" }],
    defaultValue: IRODORI_VOICE_ID,
  });
  // The production owner switch: the voice-list refresh reads the endpoints on every commit and
  // moves the store to that provider before its first await (voice-list-refresh.ts).
  const getEndpoints = () => {
    const o = endpointsSettings.get();
    return {
      tts_base_url: o.tts_base_url,
      tts_provider: (o.tts_provider === "" ? undefined : o.tts_provider) as
        | TtsProviderName
        | undefined,
    };
  };
  const refresh = createVoiceListRefresh({
    getEndpoints,
    speakerSelection,
    log,
  });
  const unsubscribe = wireVoiceListAutoRefresh({
    subscribe: endpointsSettings.subscribe,
    getEndpoints,
    refresh,
  });
  const step = createVoiceStep({
    endpointsSettings,
    ttsKeySettings,
    ttsSettings,
    speakerSelection,
    getDefaultVoices: opts.getDefaultVoices ?? (() => VOICES),
    getFetch: async () => fetchMock,
  });
  document.body.append(step.el);
  const input = step.el.querySelector<HTMLInputElement>("#yui-start-voice-key")!;
  const on = step.el.querySelector<HTMLButtonElement>(".yui-start__voice-turn")!;
  const press = async (key: string) => {
    input.value = key;
    on.click();
    await settle();
    await settle();
    await settle();
  };
  const expectNothingWritten = () => {
    expect(endpointsSettings.get().tts_provider).toBe("");
    expect(endpointsSettings.get().tts_base_url).toBe("");
    expect(endpointsSettings.get().tts_model).toBe("");
    expect(ttsKeySettings.get().apiKey).toBe("");
    expect(ttsSettings.get().enabled).toBe(false);
    expect(speakerSelection.getActiveId()).toBe(IRODORI_VOICE_ID);
  };
  const visibleText = (selector: string) =>
    [...step.el.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => !el.closest("[hidden]"))
      .map((el) => el.textContent);
  const el = (selector: string) => step.el.querySelector<HTMLElement>(selector)!;
  return {
    step,
    fetchMock,
    endpointsSettings,
    ttsKeySettings,
    ttsSettings,
    speakerSelection,
    unsubscribe,
    input,
    on,
    press,
    expectNothingWritten,
    visibleText,
    el,
  };
}

describe("createVoiceStep — the state it reads", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    setLocale("en");
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("an empty TTS URL shows the step", () => {
    const s = setup();
    expect(s.step.el.hidden).toBe(false);
    expect(s.el(".yui-start__voice-form").hidden).toBe(false);
    s.unsubscribe();
  });

  it("a configured TTS URL shows only the configured line", () => {
    const s = setup();
    s.endpointsSettings.set({ tts_base_url: "http://localhost:8088" });

    s.step.reflect();

    expect(s.el(".yui-start__voice-form").hidden).toBe(true);
    expect(s.visibleText(".yui-start__voice-configured")).toEqual([
      "Voice is on. You can change the voice in the Voice tab.",
    ]);
    expect(s.visibleText(".yui-start__voice-is-on")).toEqual([]);
    s.unsubscribe();
  });

  it("no default voices hides the whole section", () => {
    const s = setup(undefined, { getDefaultVoices: () => undefined });
    expect(s.step.el.hidden).toBe(true);
    s.unsubscribe();
  });
});

describe("createVoiceStep — turning voice on", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each<Locale>([
    "ko",
    "en",
  ])("%s: an accepted key writes the Fish provider, URL, model and key, turns TTS on, and makes the language's default voice active", async (locale) => {
    setLocale(locale);
    const s = setup();

    await s.press("fish-key");
    // The refresh the provider switch starts has listed the account's model and committed it.
    await vi.waitFor(() =>
      expect(s.speakerSelection.list().map((o) => o.id)).toContain(OWN_MODEL._id),
    );

    expect(s.endpointsSettings.get().tts_provider).toBe("fish");
    expect(s.endpointsSettings.get().tts_base_url).toBe("https://api.fish.audio");
    expect(s.endpointsSettings.get().tts_model).toBe("s2.1-pro-free");
    expect(s.ttsKeySettings.get().apiKey).toBe("fish-key");
    expect(s.ttsSettings.get().enabled).toBe(true);
    expect(s.speakerSelection.getActiveId()).toBe(VOICES[locale].id);
    expect(s.speakerSelection.list().some((o) => o.id === VOICES[locale].id)).toBe(true);
    expect(s.visibleText(".yui-start__voice-is-on")).toEqual([IS_ON[locale]]);
    expect(s.input.value).toBe("");
    s.unsubscribe();
  });

  it("an empty key shows the need-key line and sends no request", async () => {
    const s = setup();

    await s.press("   ");

    expect(s.visibleText('[role="alert"] span')).toEqual(["Paste a key first."]);
    expect(s.fetchMock).not.toHaveBeenCalled();
    s.expectNothingWritten();
    s.unsubscribe();
  });

  it("a refused key shows the refused line with the key page link and writes nothing", async () => {
    const s = setup(async () => new Response("{}", { status: 401 }));

    await s.press("fish-bad");

    expect(s.visibleText('[role="alert"] span')).toEqual([REFUSED]);
    const link = s.el(".yui-start__voice-reopen") as HTMLAnchorElement;
    expect(link.href).toBe("https://fish.audio/app/api-keys/");
    expect(link.closest("[hidden]")).toBeNull();
    s.expectNothingWritten();
    s.unsubscribe();
  });

  it.each<[string, typeof globalThis.fetch]>([
    [
      "an unreachable Fish",
      async () => {
        throw new TypeError("network");
      },
    ],
    ["an http 500", async () => new Response("{}", { status: 500 })],
  ])("%s shows the failed line and writes nothing", async (_, fetchImpl) => {
    const s = setup(fetchImpl);

    await s.press("fish-any");

    expect(s.visibleText('[role="alert"] span')).toEqual([FAILED]);
    expect(s.visibleText('[role="alert"] a')).toEqual([]);
    s.expectNothingWritten();
    s.unsubscribe();
  });

  it("Maybe later hides the step and shows the skipped line", () => {
    const s = setup();
    const later = s.step.el.querySelector<HTMLButtonElement>(".yui-start__voice-later")!;

    later.click();

    expect(s.el(".yui-start__voice-form").hidden).toBe(true);
    expect(s.visibleText(".yui-start__voice-skipped")).toEqual([
      "You can turn on voice later in the Voice tab.",
    ]);
    s.expectNothingWritten();
    s.unsubscribe();
  });

  it.each<[string, (s: ReturnType<typeof setup>) => void]>([
    ["dispose", (s) => s.step.dispose()],
    ["Maybe later", (s) => s.el(".yui-start__voice-later").click()],
  ])("an ok resolved after %s writes nothing", async (_, interrupt) => {
    let respond: (res: Response) => void = () => {};
    const s = setup(
      () =>
        new Promise<Response>((r) => {
          respond = r;
        }),
    );

    await settle();
    s.input.value = "fish-key";
    s.on.click();
    await settle();
    interrupt(s);
    respond(new Response("{}", { status: 200 }));
    await settle();
    await settle();
    await settle();

    s.expectNothingWritten();
    s.unsubscribe();
  });
});
