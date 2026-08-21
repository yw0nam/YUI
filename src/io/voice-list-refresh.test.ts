import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeakerOption } from "./speaker-selection";

const { listVoices, selectFetch } = vi.hoisted(() => ({
  listVoices: vi.fn<(o: unknown) => Promise<string[]>>().mockResolvedValue([]),
  selectFetch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./tts-voices", () => ({ listVoices }));
vi.mock("./chat-client", () => ({ selectFetch }));

import { createVoiceListRefresh, wireVoiceListAutoRefresh } from "./voice-list-refresh";

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

describe("createVoiceListRefresh — re-uploading user voices the server lost", () => {
  const userOpt: SpeakerOption = {
    id: "myvoice",
    label: "My Voice",
    ref_url: "asset://x/clip.mp3",
    source: "user",
  };

  it("re-uploads a user option missing from the server list", async () => {
    listVoices.mockResolvedValue(["ナツメ"]);
    const reuploadUserVoice = vi.fn().mockResolvedValue(undefined);
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      speakerSelection: fakeStore([userOpt]),
      reuploadUserVoice,
      log: noopLog,
    });

    await refresh();

    expect(reuploadUserVoice).toHaveBeenCalledWith(userOpt);
  });

  it("leaves a user option alone when the server still lists it", async () => {
    listVoices.mockResolvedValue(["myvoice"]);
    const reuploadUserVoice = vi.fn();
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      speakerSelection: fakeStore([userOpt]),
      reuploadUserVoice,
      log: noopLog,
    });

    await refresh();

    expect(reuploadUserVoice).not.toHaveBeenCalled();
  });

  it("skips a user option with no local clip to re-upload from", async () => {
    listVoices.mockResolvedValue([]);
    const reuploadUserVoice = vi.fn();
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      speakerSelection: fakeStore([{ ...userOpt, ref_url: "" }]),
      reuploadUserVoice,
      log: noopLog,
    });

    await refresh();

    expect(reuploadUserVoice).not.toHaveBeenCalled();
  });

  it("warns and still completes when a re-upload rejects", async () => {
    listVoices.mockResolvedValue([]);
    const reuploadUserVoice = vi.fn().mockRejectedValue(new Error("server sad"));
    const refresh = createVoiceListRefresh({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      speakerSelection: fakeStore([userOpt]),
      reuploadUserVoice,
      log: noopLog,
    });

    await expect(refresh()).resolves.toBeUndefined();
    expect(noopLog.warn).toHaveBeenCalledWith(
      "voice_reupload_failed",
      expect.objectContaining({ id: "myvoice" }),
    );
  });
});

describe("wireVoiceListAutoRefresh — endpoints override edits refetch the voice list", () => {
  function fakeSettings(initial: { tts_base_url?: string; tts_speaker?: string }) {
    let value = initial;
    const subs = new Set<() => void>();
    return {
      subscribe: (cb: () => void) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
      set(next: typeof initial) {
        value = next;
        for (const cb of subs) cb();
      },
      get: () => value,
    };
  }

  it("refreshes when tts_base_url changes", () => {
    const settings = fakeSettings({ tts_base_url: "http://a" });
    const refresh = vi.fn().mockResolvedValue(undefined);
    wireVoiceListAutoRefresh({
      subscribe: settings.subscribe,
      getEndpoints: settings.get,
      refresh,
    });

    settings.set({ tts_base_url: "http://b" });

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refreshes when tts_speaker changes", () => {
    const settings = fakeSettings({ tts_base_url: "http://a", tts_speaker: "x" });
    const refresh = vi.fn().mockResolvedValue(undefined);
    wireVoiceListAutoRefresh({
      subscribe: settings.subscribe,
      getEndpoints: settings.get,
      refresh,
    });

    settings.set({ tts_base_url: "http://a", tts_speaker: "y" });

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("ignores a commit that leaves the TTS fields unchanged", () => {
    const settings = fakeSettings({ tts_base_url: "http://a" });
    const refresh = vi.fn();
    wireVoiceListAutoRefresh({
      subscribe: settings.subscribe,
      getEndpoints: settings.get,
      refresh,
    });

    settings.set({ tts_base_url: "http://a" }); // e.g. a chat-field edit notified the store

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not throw when getEndpoints throws at wire time (pet window wires before config loads)", () => {
    const settings = fakeSettings({ tts_base_url: "http://a" });
    const refresh = vi.fn().mockResolvedValue(undefined);

    expect(() =>
      wireVoiceListAutoRefresh({
        subscribe: settings.subscribe,
        getEndpoints: () => {
          throw new Error("[config] store.get() before load()");
        },
        refresh,
      }),
    ).not.toThrow();
  });

  it("recovers after a wire-time getEndpoints throw: the first readable change refreshes", () => {
    const settings = fakeSettings({ tts_base_url: "http://a" });
    const refresh = vi.fn().mockResolvedValue(undefined);
    let loaded = false;
    wireVoiceListAutoRefresh({
      subscribe: settings.subscribe,
      getEndpoints: () => {
        if (!loaded) throw new Error("[config] store.get() before load()");
        return settings.get();
      },
      refresh,
    });

    loaded = true;
    settings.set({ tts_base_url: "http://b" });

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("skips a commit while getEndpoints still throws, without breaking the subscriber", () => {
    const settings = fakeSettings({ tts_base_url: "http://a" });
    const refresh = vi.fn().mockResolvedValue(undefined);
    wireVoiceListAutoRefresh({
      subscribe: settings.subscribe,
      getEndpoints: () => {
        throw new Error("[config] store.get() before load()");
      },
      refresh,
    });

    expect(() => settings.set({ tts_base_url: "http://b" })).not.toThrow();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns the store's unsubscribe", () => {
    const settings = fakeSettings({});
    const refresh = vi.fn();
    const off = wireVoiceListAutoRefresh({
      subscribe: settings.subscribe,
      getEndpoints: settings.get,
      refresh,
    });

    off();
    settings.set({ tts_base_url: "http://b" });

    expect(refresh).not.toHaveBeenCalled();
  });
});
