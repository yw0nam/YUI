import { beforeEach, describe, expect, it, vi } from "vitest";

const { listVoices, upsertVoice, listFishVoices, upsertFishVoice } = vi.hoisted(() => ({
  listVoices: vi.fn().mockResolvedValue([]),
  upsertVoice: vi.fn().mockResolvedValue(undefined),
  listFishVoices: vi.fn().mockResolvedValue([]),
  upsertFishVoice: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./tts-voices", () => ({ listVoices, upsertVoice, deleteVoice: vi.fn() }));
vi.mock("./fish-voices", () => ({
  listFishVoices,
  upsertFishVoice,
  deleteFishVoice: vi.fn(),
}));

const { selectFetch } = vi.hoisted(() => ({ selectFetch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../chat/chat-client", () => ({ selectFetch }));

const { copyVoiceFile, pickVoiceFile, removeOrphanImport, removeUserVoice, renameUserVoice } =
  vi.hoisted(() => ({
    copyVoiceFile: vi.fn(),
    renameUserVoice: vi.fn(),
    pickVoiceFile: vi.fn(),
    removeOrphanImport: vi.fn(async (id: string, remove: (id: string) => Promise<void>) => {
      await remove(id);
    }),
    removeUserVoice: vi.fn().mockResolvedValue(undefined),
  }));
vi.mock("../../assets/user-asset-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/user-asset-import")>()),
  removeOrphanImport,
}));
vi.mock("./voice-import", () => ({
  copyVoiceFile,
  pickVoiceFile,
  removeUserVoice,
  renameUserVoice,
  fileStemFromPath: (path: string) => {
    const base = path.split(/[\\/]/).pop() ?? path;
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
  },
}));

import type { TtsProviderName } from "../../../contract";
import { createSpeakerSelection, type SpeakerOption } from "./speaker-selection";
import { createVoiceImportFlow } from "./voice-import-flow";

const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const IMPORTED = {
  id: "myvoice",
  label: "My Voice",
  ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
  source: "user" as const,
};

// The native copy files the clip under the id the desired name sanitizes to.
const copyUnder = async (_src: string, desired: string) => ({
  id: desired,
  label: desired,
  ref_url: `asset://localhost/app-data/references/${desired}/clip.wav`,
  source: "user" as const,
});

function fakeStore(stored: SpeakerOption[] = []) {
  return {
    list: vi.fn(() => [] as SpeakerOption[]),
    listUser: vi.fn(() => stored),
    addUserOption: vi.fn(),
    select: vi.fn(),
  };
}

// Explicit arg, no default — build(undefined) must mean "no base url", not "fall back to one".
function build(
  baseUrl: string | undefined,
  provider?: TtsProviderName,
  stored: SpeakerOption[] = [],
) {
  const speakerSelection = fakeStore(stored);
  const endpoints = { tts_base_url: baseUrl, tts_provider: provider };
  const flow = createVoiceImportFlow({
    getEndpoints: () => endpoints,
    speakerSelection,
    log: noopLog,
  });
  return { ...flow, speakerSelection, endpoints };
}

describe("createVoiceImportFlow", () => {
  beforeEach(() => {
    listVoices.mockReset().mockResolvedValue([]);
    upsertVoice.mockReset().mockResolvedValue(undefined);
    listFishVoices.mockReset().mockResolvedValue([]);
    upsertFishVoice.mockReset().mockResolvedValue(undefined);
    copyVoiceFile.mockReset().mockResolvedValue(IMPORTED);
    renameUserVoice.mockReset();
    pickVoiceFile.mockReset();
    removeOrphanImport.mockClear();
    removeUserVoice.mockReset().mockResolvedValue(undefined);
    noopLog.error.mockClear();
  });

  describe("fish — the same file an Irodori voice was imported from", () => {
    const NATSUME: SpeakerOption = {
      id: "natsume",
      label: "natsume",
      ref_url: "asset://localhost/app-data/references/natsume/clip.wav",
      source: "user",
      provider: "irodori",
    };
    beforeEach(() => {
      copyVoiceFile.mockImplementation(copyUnder);
    });

    it("stages the copy under a unique id and moves it to the model id, never touching natsume", async () => {
      upsertFishVoice.mockResolvedValue("model9");
      renameUserVoice.mockResolvedValue("asset://localhost/app-data/references/model9/clip.wav");
      const { commitVoiceImport, speakerSelection } = build("https://api.fish.audio", "fish", [
        NATSUME,
      ]);

      await commitVoiceImport("/tmp/natsume.wav", "natsume");

      const staged = copyVoiceFile.mock.calls[0][1] as string;
      expect(staged).not.toBe("natsume");
      expect(upsertFishVoice.mock.calls[0][0]).toMatchObject({ name: "natsume" });
      expect(renameUserVoice).toHaveBeenCalledWith(staged, "model9");
      expect(removeUserVoice).not.toHaveBeenCalledWith("natsume");
      expect(speakerSelection.addUserOption).toHaveBeenCalledWith(
        expect.objectContaining({ id: "model9", label: "natsume", provider: "fish" }),
      );
    });

    it("cleans up only the staged copy when the upload fails", async () => {
      upsertFishVoice.mockRejectedValue(new Error("HTTP 400: invalid audio"));
      const { commitVoiceImport } = build("https://api.fish.audio", "fish", [NATSUME]);

      await expect(commitVoiceImport("/tmp/natsume.wav", "natsume")).rejects.toThrow();

      const staged = copyVoiceFile.mock.calls[0][1] as string;
      expect(removeUserVoice).toHaveBeenCalledWith(staged);
      expect(removeUserVoice).not.toHaveBeenCalledWith("natsume");
    });

    it("uploads nowhere when the provider changes during the copy, and removes the copy", async () => {
      const { commitVoiceImport, speakerSelection, endpoints } = build(
        "https://api.fish.audio",
        "fish",
      );
      copyVoiceFile.mockImplementation(async (src: string, desired: string) => {
        endpoints.tts_provider = "irodori";
        return copyUnder(src, desired);
      });

      await commitVoiceImport("/tmp/natsume.wav", "natsume");

      expect(upsertFishVoice).not.toHaveBeenCalled();
      expect(upsertVoice).not.toHaveBeenCalled();
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(removeUserVoice).toHaveBeenCalledWith(copyVoiceFile.mock.calls[0][1]);
    });

    it("commits nothing and leaves no folder when the server changes during the rename", async () => {
      upsertFishVoice.mockResolvedValue("model9");
      const { commitVoiceImport, speakerSelection, endpoints } = build(
        "https://api.fish.audio",
        "fish",
      );
      renameUserVoice.mockImplementation(async () => {
        endpoints.tts_base_url = "https://fish.other";
        return "asset://localhost/app-data/references/model9/clip.wav";
      });

      await commitVoiceImport("/tmp/natsume.wav", "natsume");

      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(speakerSelection.select).not.toHaveBeenCalled();
      expect(removeUserVoice).toHaveBeenCalledWith("model9");
    });
  });

  describe("fish", () => {
    it("uploads the multipart import, moves the clip to the server-assigned _id and selects it", async () => {
      upsertFishVoice.mockResolvedValue("model_9");
      renameUserVoice.mockResolvedValue("asset://localhost/app-data/references/model_9/clip.wav");
      const { commitVoiceImport, speakerSelection } = build("https://api.fish.audio", "fish");

      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(upsertFishVoice).toHaveBeenCalledOnce();
      expect(upsertFishVoice.mock.calls[0][0]).toMatchObject({
        baseUrl: "https://api.fish.audio",
        name: "My Voice",
        refUrl: IMPORTED.ref_url,
      });
      expect(upsertVoice).not.toHaveBeenCalled();
      expect(renameUserVoice).toHaveBeenCalledWith("myvoice", "model_9");
      expect(speakerSelection.addUserOption).toHaveBeenCalledWith({
        ...IMPORTED,
        id: "model_9",
        ref_url: "asset://localhost/app-data/references/model_9/clip.wav",
        revision: 1,
        provider: "fish",
      });
      expect(speakerSelection.select).toHaveBeenCalledWith("model_9");
    });

    it("adds and selects nothing when the provider changed while the upload ran", async () => {
      const { commitVoiceImport, speakerSelection, endpoints } = build(
        "https://api.fish.audio",
        "fish",
      );
      upsertFishVoice.mockImplementation(async () => {
        endpoints.tts_provider = "irodori";
        return "model_9";
      });

      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(speakerSelection.select).not.toHaveBeenCalled();
      expect(renameUserVoice).not.toHaveBeenCalled();
    });

    it("cleans up the orphan copy and rethrows when the upload fails", async () => {
      upsertFishVoice.mockRejectedValue(new Error("HTTP 400: invalid audio"));
      const { commitVoiceImport, speakerSelection } = build("https://api.fish.audio", "fish");

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "My Voice")).rejects.toThrow(
        "invalid audio",
      );

      expect(removeUserVoice).toHaveBeenCalledWith("myvoice");
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(speakerSelection.select).not.toHaveBeenCalled();
    });
  });

  describe("pickVoiceImport", () => {
    it("returns null on cancel without copying anything", async () => {
      pickVoiceFile.mockResolvedValue(null);
      const { pickVoiceImport } = build("http://localhost:8091");

      expect(await pickVoiceImport()).toBeNull();
      expect(copyVoiceFile).not.toHaveBeenCalled();
    });

    it("returns the source path plus a seed name from the file stem", async () => {
      pickVoiceFile.mockResolvedValue("/Users/me/Downloads/ナツメ.wav");
      const { pickVoiceImport } = build("http://localhost:8091");

      expect(await pickVoiceImport()).toEqual({
        srcPath: "/Users/me/Downloads/ナツメ.wav",
        seedName: "ナツメ",
      });
    });
  });

  describe("commitVoiceImport", () => {
    it("uploads the clip with upsertVoice and adds + selects the option", async () => {
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(copyVoiceFile).toHaveBeenCalledWith("/tmp/MyVoice.wav", "My Voice");
      expect(upsertVoice).toHaveBeenCalledOnce();
      expect(upsertVoice.mock.calls[0][0]).toMatchObject({
        baseUrl: "http://localhost:8091",
        id: "myvoice",
        refUrl: IMPORTED.ref_url,
      });
      expect(speakerSelection.addUserOption).toHaveBeenCalledWith({
        ...IMPORTED,
        revision: 1,
        provider: "irodori",
      });
      expect(speakerSelection.select).toHaveBeenCalledWith("myvoice");
    });

    it("hands upsertVoice the TTS key resolver so a gated server still accepts the upload", async () => {
      const getApiKey = vi.fn().mockResolvedValue("sk-tts");
      const { commitVoiceImport } = createVoiceImportFlow({
        getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
        getApiKey,
        speakerSelection: fakeStore(),
        log: noopLog,
      });

      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(upsertVoice.mock.calls[0][0]).toMatchObject({ getApiKey });
    });

    it("bumps the revision on top of whatever is already stored for that id, so a re-import invalidates other windows' filler cache", async () => {
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091");
      speakerSelection.list.mockReturnValue([{ ...IMPORTED, revision: 3 }]);

      await commitVoiceImport("/tmp/Replacement.wav", "My Voice");

      expect(speakerSelection.addUserOption).toHaveBeenCalledWith({
        ...IMPORTED,
        revision: 4,
        provider: "irodori",
      });
    });

    // upsertVoice is itself create-or-replace, so the flow has nothing to branch on — a flaked
    // list call (it resolves to null rather than throwing) can never skip the upload.
    it("never consults listVoices — a flaked list cannot skip the upload", async () => {
      listVoices.mockResolvedValue(null); // as if the server list call failed
      const { commitVoiceImport } = build("http://localhost:8091");

      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(listVoices).not.toHaveBeenCalled();
      expect(upsertVoice).toHaveBeenCalledOnce();
    });

    it("overwriting an existing name still uploads (no id-existence short circuit)", async () => {
      listVoices.mockResolvedValue(["myvoice"]); // server already has it — an explicit overwrite
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      await commitVoiceImport("/tmp/Replacement.wav", "My Voice");

      expect(upsertVoice).toHaveBeenCalledOnce();
      expect(speakerSelection.select).toHaveBeenCalledWith("myvoice");
    });

    it("cleans up the orphan copy and rethrows when the upload fails, leaving the store untouched", async () => {
      upsertVoice.mockRejectedValue(new Error("server down"));
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "My Voice")).rejects.toThrow(
        "server down",
      );

      expect(removeUserVoice).toHaveBeenCalledWith("myvoice");
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(speakerSelection.select).not.toHaveBeenCalled();
    });

    it("keeps the stored voice's folder when a same-name re-import fails, removing only the staged copy", async () => {
      copyVoiceFile.mockImplementation(copyUnder);
      upsertVoice.mockRejectedValue(new Error("server down"));
      const { commitVoiceImport } = build("http://localhost:8091", "irodori", [
        { ...IMPORTED, provider: "irodori" },
      ]);

      await expect(commitVoiceImport("/tmp/Replacement.wav", "myvoice")).rejects.toThrow(
        "server down",
      );

      expect(removeUserVoice).not.toHaveBeenCalledWith("myvoice");
      expect(removeUserVoice.mock.calls).toEqual([[copyVoiceFile.mock.calls[0][1]]]);
      expect(renameUserVoice).not.toHaveBeenCalled();
    });

    it("uploads under the name-derived id, then moves the staged clip over that id's folder", async () => {
      copyVoiceFile.mockImplementation(copyUnder);
      renameUserVoice.mockResolvedValue("asset://localhost/app-data/references/myvoice/moved.wav");
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091", "irodori");

      await commitVoiceImport("/tmp/MyVoice.wav", "myvoice");

      const staged = copyVoiceFile.mock.calls[0][1] as string;
      expect(staged).not.toBe("myvoice");
      expect(upsertVoice.mock.calls[0][0]).toMatchObject({
        id: "myvoice",
        refUrl: `asset://localhost/app-data/references/${staged}/clip.wav`,
      });
      expect(removeUserVoice.mock.calls).toEqual([["myvoice"]]);
      expect(renameUserVoice).toHaveBeenCalledWith(staged, "myvoice");
      expect(removeUserVoice.mock.invocationCallOrder[0]).toBeLessThan(
        renameUserVoice.mock.invocationCallOrder[0],
      );
      expect(upsertVoice.mock.invocationCallOrder[0]).toBeLessThan(
        removeUserVoice.mock.invocationCallOrder[0],
      );
      expect(speakerSelection.addUserOption).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "myvoice",
          ref_url: "asset://localhost/app-data/references/myvoice/moved.wav",
          provider: "irodori",
        }),
      );
      expect(speakerSelection.select).toHaveBeenCalledWith("myvoice");
    });

    it("refuses a blank name under a provider that keeps the caller's id, copying nothing", async () => {
      const { commitVoiceImport } = build("http://localhost:8091", "irodori");

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "  ")).rejects.toThrow(
        "voice name required",
      );

      expect(copyVoiceFile).not.toHaveBeenCalled();
    });

    it("throws without copying when tts_base_url is unset", async () => {
      const { commitVoiceImport, speakerSelection } = build(undefined);

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "My Voice")).rejects.toThrow(
        "tts_base_url",
      );

      expect(copyVoiceFile).not.toHaveBeenCalled();
      expect(upsertVoice).not.toHaveBeenCalled();
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
    });

    it("refuses an import under a provider that takes no uploaded voices, copying nothing", async () => {
      const { commitVoiceImport, speakerSelection } = build("https://api.openai.com", "openai");

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "My Voice")).rejects.toThrow("openai");

      expect(copyVoiceFile).not.toHaveBeenCalled();
      expect(upsertVoice).not.toHaveBeenCalled();
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
    });

    it("refuses an Irodori import whose id another provider's voice holds, copying nothing", async () => {
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091", "irodori", [
        { id: "natsume", label: "natsume", ref_url: "", source: "user", provider: "fish" },
      ]);

      await expect(commitVoiceImport("/tmp/natsume.wav", "natsume")).rejects.toThrow("natsume");

      expect(copyVoiceFile).not.toHaveBeenCalled();
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
    });

    // fakeStore() above doesn't exercise createSelectionStore's own notify logic, so it can't
    // catch a regression there — this uses the real store to pin the #506 scenario: re-importing
    // the voice that is already the active selection.
    it("notifies the real store's own subscribers when re-importing the id that is already active", async () => {
      const speakerSelection = createSpeakerSelection({ defaultValue: "" });
      speakerSelection.addUserOption(IMPORTED);
      speakerSelection.select(IMPORTED.id);
      const { commitVoiceImport } = createVoiceImportFlow({
        getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
        speakerSelection,
        log: noopLog,
      });
      const onChange = vi.fn();
      speakerSelection.subscribe(onChange);

      // Same name, same id, already active — select() alone is a no-op here (unchanged active id),
      // so addUserOption is the only thing that can wake other windows.
      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(onChange).toHaveBeenCalled();
    });
  });
});
