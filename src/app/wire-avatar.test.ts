import { beforeEach, describe, expect, it, vi } from "vitest";

// chat-client fake: wireSpeakerSelection's fetch selection never hits the network.
const { selectFetch } = vi.hoisted(() => ({ selectFetch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../io/chat/chat-client", () => ({ selectFetch }));

// Voices-API fakes — wireSpeakerSelection's refreshVoiceList exercises listVoices;
// commitVoiceImport and refreshSpeaker (tests below) exercise upsertVoice directly.
const { deleteVoice, listVoices, upsertVoice } = vi.hoisted(() => ({
  deleteVoice: vi.fn().mockResolvedValue(undefined),
  listVoices: vi.fn().mockResolvedValue([]),
  upsertVoice: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../io/voice/tts-voices", () => ({ deleteVoice, listVoices, upsertVoice }));

// voice-import fakes — wireSpeakerSelection's pickVoiceImport/commitVoiceImport exercise these
// directly; keeps the suite off the real dialog plugin / Tauri invoke.
const { pickVoiceFile, copyVoiceFile, removeOrphanImport, removeUserVoiceMock } = vi.hoisted(
  () => ({
    pickVoiceFile: vi.fn(),
    copyVoiceFile: vi.fn(),
    removeOrphanImport: vi.fn(async (id: string, remove: (id: string) => Promise<void>) => {
      await remove(id);
    }),
    removeUserVoiceMock: vi.fn().mockResolvedValue(undefined),
  }),
);
vi.mock("../io/voice/voice-import", () => ({
  pickVoiceFile,
  copyVoiceFile,
  fileStemFromPath: (path: string) => {
    const base = path.split(/[\\/]/).pop() ?? path;
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
  },
  removeUserVoice: removeUserVoiceMock,
}));

// The orphan cleanup itself is shared with the VRM import — fake it where it lives.
vi.mock("../io/assets/user-asset-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../io/assets/user-asset-import")>()),
  removeOrphanImport,
}));

import type { EndpointsConfig } from "../contract";
import type { EndpointOverrides } from "../io/settings/endpoints-settings";
import { createVoiceListRefresh } from "../io/voice/voice-list-refresh";
import { createEffectiveEndpoints, wireSpeakerSelection } from "./wire-avatar";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe("wireSpeakerSelection — refreshVoiceList", () => {
  beforeEach(() => {
    listVoices.mockReset().mockResolvedValue([]);
    selectFetch.mockClear();
  });

  it("does not call listVoices when tts_base_url is unset", async () => {
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({}),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(listVoices).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });

  it("feeds the server voice list into the manifest, mapped to id/label/empty ref_url", async () => {
    listVoices.mockResolvedValue(["ナツメ", "あやせ"]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(listVoices).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://localhost:8091" }),
    );
    expect(speakerSelection.list()).toEqual([
      { id: "ナツメ", label: "ナツメ", ref_url: "" },
      { id: "あやせ", label: "あやせ", ref_url: "" },
    ]);
    expect(speakerSelection.getActiveId()).toBe("ナツメ");
    speakerSelection.dispose();
  });

  it("a user-imported voice registered under its own id on the server keeps its label and asset:// ref_url", async () => {
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption({
      id: "myvoice",
      label: "My Voice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.mp3",
    });

    // The server now also lists "myvoice" — it was registered at import time.
    listVoices.mockResolvedValue(["ナツメ", "myvoice"]);
    await refreshVoiceList();

    const rows = speakerSelection.list().filter((o) => o.id === "myvoice");
    expect(rows).toHaveLength(1); // not duplicated — one row, not two
    expect(rows[0]).toEqual({
      id: "myvoice",
      label: "My Voice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.mp3",
      source: "user",
    });
    // Untouched server-only id still lands as a normal server entry.
    expect(speakerSelection.list().find((o) => o.id === "ナツメ")).toEqual({
      id: "ナツメ",
      label: "ナツメ",
      ref_url: "",
    });
    speakerSelection.dispose();
  });

  it("an empty server voice list yields a genuinely empty list — no phantom configured-default entry", async () => {
    listVoices.mockResolvedValue([]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(speakerSelection.list()).toEqual([]);
    expect(speakerSelection.getActiveId()).toBe("");
    speakerSelection.dispose();
  });

  it("does not select a configured tts_speaker absent from a non-empty server list", async () => {
    listVoices.mockResolvedValue(["あやせ", "レナ"]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ", // configured, but the server doesn't have it
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(speakerSelection.list().map((o) => o.id)).toEqual(["あやせ", "レナ"]);
    // Falls back to the first real (non-phantom) entry — never the unregistered configured id.
    expect(speakerSelection.getActiveId()).toBe("あやせ");
    speakerSelection.dispose();
  });

  it("selects the configured tts_speaker when the server list contains it (unchanged from before)", async () => {
    listVoices.mockResolvedValue(["あやせ", "ナツメ"]);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await refreshVoiceList();

    expect(speakerSelection.getActiveId()).toBe("ナツメ");
    speakerSelection.dispose();
  });

  it("does not let a slow earlier refresh clobber a newer manifest (out-of-order resolution)", async () => {
    // First call is slow and would resolve to a stale, single-voice manifest.
    let resolveSlow: (ids: string[]) => void = () => {};
    const slow = new Promise<string[]>((res) => {
      resolveSlow = res;
    });
    listVoices.mockReturnValueOnce(slow);
    const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({
        tts_base_url: "http://localhost:8091",
        tts_speaker: "ナツメ",
      }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    const first = refreshVoiceList(); // in flight, slow

    // Second call is fast and resolves first with the actually-current manifest.
    listVoices.mockResolvedValueOnce(["ナツメ", "あやせ"]);
    await refreshVoiceList();
    expect(speakerSelection.list().map((o) => o.id)).toEqual(["ナツメ", "あやせ"]);

    // The slow first call now resolves — it must be discarded, not overwrite the newer manifest.
    resolveSlow(["stale-only-voice"]);
    await first;
    expect(speakerSelection.list().map((o) => o.id)).toEqual(["ナツメ", "あやせ"]);

    speakerSelection.dispose();
  });
});

describe("wireSpeakerSelection — pickVoiceImport / commitVoiceImport", () => {
  beforeEach(() => {
    listVoices.mockReset().mockResolvedValue([]);
    upsertVoice.mockReset().mockResolvedValue(undefined);
    pickVoiceFile.mockReset();
    copyVoiceFile.mockReset();
    removeOrphanImport.mockClear();
    removeUserVoiceMock.mockReset().mockResolvedValue(undefined);
    selectFetch.mockClear();
  });

  it("pickVoiceImport returns null (cancel) without touching copyVoiceFile", async () => {
    pickVoiceFile.mockResolvedValue(null);
    const { pickVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    const out = await pickVoiceImport();

    expect(out).toBeNull();
    expect(copyVoiceFile).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });

  it("pickVoiceImport returns the srcPath + a seed name derived from the file stem", async () => {
    pickVoiceFile.mockResolvedValue("/Users/me/Downloads/ナツメ.wav");
    const { pickVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    const out = await pickVoiceImport();

    expect(out).toEqual({ srcPath: "/Users/me/Downloads/ナツメ.wav", seedName: "ナツメ" });
    speakerSelection.dispose();
  });

  it("commitVoiceImport uploads via upsertVoice and commits the option to the store", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "myvoice",
      label: "myvoice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
    });
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await commitVoiceImport("/tmp/MyVoice.wav", "myvoice");

    expect(copyVoiceFile).toHaveBeenCalledWith("/tmp/MyVoice.wav", "myvoice");
    expect(upsertVoice).toHaveBeenCalledOnce();
    expect(speakerSelection.list().map((o) => o.id)).toContain("myvoice");
    expect(speakerSelection.getActiveId()).toBe("myvoice");
    speakerSelection.dispose();
  });

  it("commitVoiceImport overwrites via upsertVoice when the server already lists the id (duplicate name)", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "natsume",
      label: "natsume",
      ref_url: "asset://localhost/app-data/references/natsume/clip.wav",
      source: "user",
    });
    listVoices.mockResolvedValue(["natsume"]); // server already has this id — explicit overwrite
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await commitVoiceImport("/tmp/New.wav", "natsume");

    expect(upsertVoice).toHaveBeenCalledOnce();
    expect(upsertVoice.mock.calls[0][0]).toMatchObject({ id: "natsume" });
    expect(speakerSelection.getActiveId()).toBe("natsume");
    speakerSelection.dispose();
  });

  it("on registration failure, cleans up the orphan copy and still throws (option never added)", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "myvoice",
      label: "myvoice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
    });
    upsertVoice.mockRejectedValue(new Error("server down"));
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await expect(commitVoiceImport("/tmp/MyVoice.wav", "myvoice")).rejects.toThrow("server down");

    expect(removeOrphanImport).toHaveBeenCalledWith(
      "myvoice",
      expect.any(Function),
      expect.any(Function),
    );
    expect(removeUserVoiceMock).toHaveBeenCalledWith("myvoice");
    expect(speakerSelection.list().map((o) => o.id)).not.toContain("myvoice");
    speakerSelection.dispose();
  });

  it("throws without copying when tts_base_url is unset (guard before any upload)", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "myvoice",
      label: "myvoice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
    });
    const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({}),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await expect(commitVoiceImport("/tmp/MyVoice.wav", "myvoice")).rejects.toThrow("tts_base_url");
    expect(removeOrphanImport).toHaveBeenCalledWith(
      "myvoice",
      expect.any(Function),
      expect.any(Function),
    );
    speakerSelection.dispose();
  });

  // Pins the refreshVoiceList regression fix (excludes source:"user" ids from the server-derived
  // manifest) specifically for the new pick/commit flow: a voice just imported via commitVoiceImport
  // must not get clobbered by a refreshVoiceList triggered right after (e.g. the next panel open).
  it("a voice imported via commitVoiceImport survives a refreshVoiceList right after (next panel open)", async () => {
    copyVoiceFile.mockResolvedValue({
      id: "myvoice",
      label: "My Voice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
    });
    listVoices.mockResolvedValue([]); // not registered yet at commit time
    const { commitVoiceImport, refreshVoiceList, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");
    expect(speakerSelection.list().map((o) => o.id)).toContain("myvoice");

    // The server now also lists it (registered at import time) — simulate the next panel open.
    listVoices.mockResolvedValue(["myvoice"]);
    await refreshVoiceList();

    const rows = speakerSelection.list().filter((o) => o.id === "myvoice");
    expect(rows).toHaveLength(1); // not duplicated
    expect(rows[0]).toEqual({
      id: "myvoice",
      label: "My Voice",
      ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
      source: "user",
      revision: 1,
    });
    speakerSelection.dispose();
  });
});

describe("createEffectiveEndpoints", () => {
  const overrides = (patch: Partial<EndpointOverrides> = {}): EndpointOverrides => ({
    chat_base_url: "",
    stt_base_url: "",
    tts_base_url: "",
    broker_base_url: "",
    chat_model: "",
    chat_model_context_window: "",
    chat_api: "",
    ...patch,
  });
  const bundled = (patch: Partial<EndpointsConfig> = {}): EndpointsConfig => ({
    chat_base_url: "",
    stt_base_url: "",
    tts_base_url: "",
    ...patch,
  });

  // The bug this pins: the settings window read the bundled config directly, so a TTS server set
  // only as a user override left it issuing no requests at all.
  it("layers a user override onto a bundled config that has no URL of its own", () => {
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => bundled(),
      getOverrides: () => overrides({ tts_base_url: "http://override.test" }),
    });

    expect(getEndpoints()?.tts_base_url).toBe("http://override.test");
  });

  it("keeps the bundled value when no override is set", () => {
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => bundled({ tts_base_url: "http://bundled.test" }),
      getOverrides: () => overrides(),
    });

    expect(getEndpoints()?.tts_base_url).toBe("http://bundled.test");
  });

  it("resolves null while the config has not loaded", () => {
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => null,
      getOverrides: () => overrides({ tts_base_url: "http://override.test" }),
    });

    expect(getEndpoints()).toBeNull();
  });

  it("re-reads both sides per call, so a later override edit takes effect", () => {
    let ov = overrides();
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => bundled(),
      getOverrides: () => ov,
    });

    expect(getEndpoints()?.tts_base_url).toBe("");
    ov = overrides({ tts_base_url: "http://override.test" });
    expect(getEndpoints()?.tts_base_url).toBe("http://override.test");
  });

  // Every network consumer of the settings window reaches the server through wireSpeakerSelection,
  // so the override has to survive that composition — not merely the merge in isolation.
  describe("composed into wireSpeakerSelection", () => {
    const overrideOnly = () =>
      createEffectiveEndpoints({
        getBundled: () => bundled(),
        getOverrides: () => overrides({ tts_base_url: "http://override.test" }),
      });

    beforeEach(() => {
      listVoices.mockReset().mockResolvedValue(["ナツメ"]);
      upsertVoice.mockReset().mockResolvedValue(undefined);
      copyVoiceFile.mockReset();
      pickVoiceFile.mockReset();
    });

    it("refreshVoiceList reaches the override URL", async () => {
      const { refreshVoiceList, speakerSelection } = wireSpeakerSelection({
        getEndpoints: overrideOnly(),
        log: noopLog,
        broadcastSettings: () => {},
      });

      await refreshVoiceList();

      expect(listVoices).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "http://override.test" }),
      );
      speakerSelection.dispose();
    });

    it("refreshSpeaker uploads to the override URL", async () => {
      const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
        getEndpoints: overrideOnly(),
        log: noopLog,
        broadcastSettings: () => {},
      });
      const option = { id: "myvoice", ref_url: "asset://x/clip.wav", source: "user" as const };
      speakerSelection.addUserOption(option);

      await refreshSpeaker(option);

      expect(upsertVoice).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "http://override.test" }),
      );
      speakerSelection.dispose();
    });

    it("commitVoiceImport uploads to the override URL", async () => {
      copyVoiceFile.mockResolvedValue({
        id: "myvoice",
        label: "My Voice",
        ref_url: "asset://x/clip.wav",
        source: "user",
      });
      const { commitVoiceImport, speakerSelection } = wireSpeakerSelection({
        getEndpoints: overrideOnly(),
        log: noopLog,
        broadcastSettings: () => {},
      });

      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(upsertVoice).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "http://override.test" }),
      );
      speakerSelection.dispose();
    });

    // The settings window loads its config best-effort, so every consumer has to survive the
    // not-yet-loaded window with its own error rather than dereferencing null.
    it("reports a missing server cleanly while the config has not loaded", async () => {
      const notLoaded = createEffectiveEndpoints({
        getBundled: () => null,
        getOverrides: () => overrides(),
      });
      copyVoiceFile.mockResolvedValue({
        id: "myvoice",
        label: "My Voice",
        ref_url: "asset://x/clip.wav",
        source: "user",
      });
      const { refreshVoiceList, refreshSpeaker, commitVoiceImport, speakerSelection } =
        wireSpeakerSelection({
          getEndpoints: notLoaded,
          log: noopLog,
          broadcastSettings: () => {},
        });

      await expect(refreshVoiceList()).resolves.toBeUndefined();
      expect(listVoices).not.toHaveBeenCalled();

      await expect(
        refreshSpeaker({ id: "myvoice", ref_url: "asset://x/clip.wav" }),
      ).rejects.toThrow("voice refresh requires tts_base_url");

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "My Voice")).rejects.toThrow(
        "voice import requires tts_base_url",
      );
      expect(upsertVoice).not.toHaveBeenCalled();

      speakerSelection.dispose();
    });
  });

  // The settings window's voice list is the only place a speaker can be picked, so an
  // override-only TTS server has to reach listVoices for the picker to populate at all.
  it("carries the override all the way into the voice-list request", async () => {
    const getEndpoints = createEffectiveEndpoints({
      getBundled: () => bundled(),
      getOverrides: () => overrides({ tts_base_url: "http://override.test" }),
    });
    const refreshVoiceList = createVoiceListRefresh({
      getEndpoints,
      speakerSelection: { list: () => [], setManifest: () => {} },
      log: noopLog,
    });

    await refreshVoiceList();

    expect(listVoices).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://override.test" }),
    );
  });
});

describe("wireSpeakerSelection — swapSpeaker / refreshSpeaker", () => {
  const USER_VOICE = {
    id: "myvoice",
    label: "My Voice",
    ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
    source: "user" as const,
  };

  beforeEach(() => {
    deleteVoice.mockReset().mockResolvedValue(undefined);
    listVoices.mockReset().mockResolvedValue([]);
    upsertVoice.mockReset().mockResolvedValue(undefined);
    removeUserVoiceMock.mockReset().mockResolvedValue(undefined);
    selectFetch.mockClear();
  });

  // Voices live on the server across restarts, so selecting one is a store commit and nothing else.
  it("swapSpeaker commits the selection without any upload", async () => {
    const { swapSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption(USER_VOICE);

    await swapSpeaker(USER_VOICE);

    expect(upsertVoice).not.toHaveBeenCalled();
    expect(speakerSelection.getActiveId()).toBe("myvoice");
    speakerSelection.dispose();
  });

  it("refreshSpeaker re-uploads the clip and bumps the persisted revision", async () => {
    const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption({ ...USER_VOICE, revision: 2 });

    await refreshSpeaker({ ...USER_VOICE, revision: 2 });

    expect(upsertVoice).toHaveBeenCalledOnce();
    expect(upsertVoice.mock.calls[0][0]).toMatchObject({
      baseUrl: "http://localhost:8091",
      id: "myvoice",
      refUrl: USER_VOICE.ref_url,
    });
    expect(speakerSelection.list().find((o) => o.id === "myvoice")?.revision).toBe(3);
    speakerSelection.dispose();
  });

  it("refreshSpeaker starts the revision at 1 for a never-refreshed voice", async () => {
    const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption(USER_VOICE);

    await refreshSpeaker(USER_VOICE);

    expect(speakerSelection.list().find((o) => o.id === "myvoice")?.revision).toBe(1);
    speakerSelection.dispose();
  });

  it("refreshSpeaker leaves the revision alone when the upload fails", async () => {
    upsertVoice.mockRejectedValue(new Error("server down"));
    const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption({ ...USER_VOICE, revision: 2 });

    await expect(refreshSpeaker({ ...USER_VOICE, revision: 2 })).rejects.toThrow("server down");

    expect(speakerSelection.list().find((o) => o.id === "myvoice")?.revision).toBe(2);
    speakerSelection.dispose();
  });

  it("refreshSpeaker throws when tts_base_url is unset", async () => {
    const { refreshSpeaker, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({}),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await expect(refreshSpeaker(USER_VOICE)).rejects.toThrow("tts_base_url");
    expect(upsertVoice).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });

  it("removes the server voice before deleting the local reference clip", async () => {
    const { removeVoice, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      getApiKey: async () => "sk-tts",
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.addUserOption(USER_VOICE);

    await removeVoice("myvoice");

    expect(deleteVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "http://localhost:8091",
        id: "myvoice",
        getApiKey: expect.any(Function),
      }),
    );
    expect(deleteVoice.mock.invocationCallOrder[0]).toBeLessThan(
      removeUserVoiceMock.mock.invocationCallOrder[0],
    );
    speakerSelection.dispose();
  });

  it("deletes a bundled (server-listed) voice on the server without touching local clips", async () => {
    const { removeVoice, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });
    speakerSelection.setManifest({
      available: [{ id: "natsume", label: "natsume", ref_url: "" }],
      defaultValue: "natsume",
    });

    await removeVoice("natsume");

    expect(deleteVoice).toHaveBeenCalledWith(expect.objectContaining({ id: "natsume" }));
    expect(removeUserVoiceMock).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });

  it("does not delete the local reference clip when the server delete fails", async () => {
    deleteVoice.mockRejectedValue(new Error("server down"));
    const { removeVoice, speakerSelection } = wireSpeakerSelection({
      getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
      log: noopLog,
      broadcastSettings: () => {},
    });

    await expect(removeVoice("myvoice")).rejects.toThrow("server down");

    expect(removeUserVoiceMock).not.toHaveBeenCalled();
    speakerSelection.dispose();
  });
});
