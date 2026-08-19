import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeakerOption } from "./speaker-selection";

const { listVoices, selectFetch } = vi.hoisted(() => ({
  listVoices: vi.fn<(o: unknown) => Promise<string[]>>().mockResolvedValue([]),
  selectFetch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./tts-voices", () => ({ listVoices }));
vi.mock("./chat-client", () => ({ selectFetch }));

import { createVoiceListRefresh } from "./voice-list-refresh";

const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Minimal stand-in for the speaker store — only the two methods the refresher touches. */
function fakeStore(userOptions: SpeakerOption[] = []) {
  const setManifest = vi.fn();
  return {
    list: () => userOptions,
    setManifest,
    _manifest: () => setManifest.mock.calls.at(-1)?.[0],
  };
}

describe("createVoiceListRefresh", () => {
  beforeEach(() => {
    listVoices.mockReset().mockResolvedValue([]);
    selectFetch.mockClear();
    noopLog.warn.mockClear();
  });

  it("does not call listVoices when tts_base_url is unset", async () => {
    const store = fakeStore();
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({}),
      speakerSelection: store,
      log: noopLog,
    });

    await refresh();

    expect(listVoices).not.toHaveBeenCalled();
    expect(store.setManifest).not.toHaveBeenCalled();
  });

  it("does not call listVoices when getEndpoints reports not-ready (null)", async () => {
    const store = fakeStore();
    const refresh = createVoiceListRefresh({
      getEndpoints: () => null,
      speakerSelection: store,
      log: noopLog,
    });

    await refresh();

    expect(listVoices).not.toHaveBeenCalled();
  });

  it("maps the server ids into the manifest as id/label/empty ref_url", async () => {
    listVoices.mockResolvedValue(["ナツメ", "あやせ"]);
    const store = fakeStore();
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      speakerSelection: store,
      log: noopLog,
    });

    await refresh();

    expect(listVoices).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://localhost:8091" }),
    );
    expect(store._manifest()).toEqual({
      available: [
        { id: "ナツメ", label: "ナツメ", ref_url: "" },
        { id: "あやせ", label: "あやせ", ref_url: "" },
      ],
      defaultValue: "ナツメ",
    });
  });

  it("hands listVoices the TTS key resolver so a gated server still answers", async () => {
    const getApiKey = vi.fn().mockResolvedValue("sk-tts");
    const store = fakeStore();
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      getApiKey,
      speakerSelection: store,
      log: noopLog,
    });

    await refresh();

    expect(listVoices).toHaveBeenCalledWith(expect.objectContaining({ getApiKey }));
  });

  it("does not conjure a configured speaker the server does not list", async () => {
    listVoices.mockResolvedValue(["あやせ"]);
    const store = fakeStore();
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      speakerSelection: store,
      log: noopLog,
    });

    await refresh();

    expect(store._manifest().defaultValue).toBe("");
  });

  it("excludes ids already owned by a user option so the richer user record stays authoritative", async () => {
    listVoices.mockResolvedValue(["ナツメ", "myvoice"]);
    const store = fakeStore([
      { id: "myvoice", label: "My Voice", ref_url: "asset://x/clip.mp3", source: "user" },
    ]);
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      speakerSelection: store,
      log: noopLog,
    });

    await refresh();

    expect(store._manifest().available).toEqual([{ id: "ナツメ", label: "ナツメ", ref_url: "" }]);
  });

  it("discards a stale (out-of-order) resolution instead of clobbering a newer manifest", async () => {
    let resolveSlow: (ids: string[]) => void = () => {};
    listVoices.mockReturnValueOnce(
      new Promise<string[]>((res) => {
        resolveSlow = res;
      }),
    );
    const store = fakeStore();
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      speakerSelection: store,
      log: noopLog,
    });

    const first = refresh();
    listVoices.mockResolvedValueOnce(["fresh"]);
    await refresh();
    expect(store._manifest().available).toEqual([{ id: "fresh", label: "fresh", ref_url: "" }]);

    resolveSlow(["stale"]);
    await first;

    expect(store.setManifest).toHaveBeenCalledOnce();
    expect(store._manifest().available).toEqual([{ id: "fresh", label: "fresh", ref_url: "" }]);
  });

  it("warns instead of throwing when reading the endpoints config fails", async () => {
    const store = fakeStore();
    const refresh = createVoiceListRefresh({
      getEndpoints: () => {
        throw new Error("config not loaded");
      },
      speakerSelection: store,
      log: noopLog,
    });

    await expect(refresh()).resolves.toBeUndefined();
    expect(noopLog.warn).toHaveBeenCalledOnce();
    expect(store.setManifest).not.toHaveBeenCalled();
  });
});
