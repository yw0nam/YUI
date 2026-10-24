import { beforeEach, describe, expect, it, vi } from "vitest";

const { listVoices, upsertVoice, listFishVoices, upsertFishVoice } = vi.hoisted(() => ({
  listVoices: vi.fn<typeof import("./tts-voices").listVoices>(async () => []),
  upsertVoice: vi.fn<typeof import("./tts-voices").upsertVoice>(async () => undefined),
  listFishVoices: vi.fn(async () => []),
  upsertFishVoice: vi.fn<
    (
      ...args: Parameters<typeof import("./fish-voices").upsertFishVoice>
    ) => Promise<string | undefined>
  >(async () => undefined),
}));
vi.mock("./tts-voices", () => ({ listVoices, upsertVoice, deleteVoice: vi.fn() }));
vi.mock("./fish-voices", () => ({
  listFishVoices,
  upsertFishVoice,
  deleteFishVoice: vi.fn(),
}));

const { selectFetch } = vi.hoisted(() => ({ selectFetch: vi.fn(async () => undefined) }));
vi.mock("../../chat/stream/chat-client", () => ({ selectFetch }));

const { pickVoiceFile, removeOrphanImport, removeUserVoice, renameUserVoice } = vi.hoisted(() => ({
  renameUserVoice: vi.fn(),
  pickVoiceFile: vi.fn(),
  removeOrphanImport: vi.fn<typeof import("../../assets/user-asset-import").removeOrphanImport>(
    async (id, remove) => {
      await remove(id);
    },
  ),
  removeUserVoice: vi.fn(async () => undefined),
}));
vi.mock("../../assets/user-asset-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/user-asset-import")>()),
  removeOrphanImport,
}));
vi.mock("./voice-import", () => ({ pickVoiceFile, removeUserVoice, renameUserVoice }));

import type { TtsProviderName } from "../../../contract";
import { voiceIdFromName } from "../../assets/safe-id";
import { createSpeakerSelection, type SpeakerOption } from "./speaker-selection";
import { createVoiceImportFlow } from "./voice-import-flow";

const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const IMPORTED = {
  id: "myvoice",
  label: "My Voice",
  ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
  source: "user" as const,
};

// The Rust pick stages the clip under the staging folder the flow named.
const stagedUnder = (stagingId: string) => ({
  staged: {
    id: stagingId,
    label: stagingId,
    ref_url: `asset://localhost/app-data/references/${stagingId}/clip.wav`,
    source: "user" as const,
  },
  seedName: stagingId,
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
    pickVoiceFile
      .mockReset()
      .mockImplementation(async (stagingId: string) => stagedUnder(stagingId));
    renameUserVoice
      .mockReset()
      .mockImplementation(
        async (_from: string, to: string) => `asset://localhost/app-data/references/${to}/clip.wav`,
      );
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
    it("stages the copy under a unique id and moves it to the model id, never touching natsume", async () => {
      upsertFishVoice.mockResolvedValue("model9");
      renameUserVoice.mockResolvedValue("asset://localhost/app-data/references/model9/clip.wav");
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build(
        "https://api.fish.audio",
        "fish",
        [NATSUME],
      );

      const staged = (await pickVoiceImport())!.stagedId;
      expect(staged).not.toBe("natsume");
      await commitVoiceImport(staged, "natsume");

      expect(staged).toMatch(/^import-[0-9a-f-]{36}$/);
      expect(upsertFishVoice.mock.calls[0][0]).toMatchObject({ name: "natsume" });
      expect(renameUserVoice).toHaveBeenCalledWith(staged, "model9");
      expect(removeUserVoice).not.toHaveBeenCalledWith("natsume");
      expect(speakerSelection.addUserOption).toHaveBeenCalledWith(
        expect.objectContaining({ id: "model9", label: "natsume", provider: "fish" }),
      );
    });

    it("cleans up only the staged copy when the upload fails", async () => {
      upsertFishVoice.mockRejectedValue(new Error("HTTP 400: invalid audio"));
      const { pickVoiceImport, commitVoiceImport } = build("https://api.fish.audio", "fish", [
        NATSUME,
      ]);

      const staged = (await pickVoiceImport())!.stagedId;
      await expect(commitVoiceImport(staged, "natsume")).rejects.toThrow();

      expect(removeUserVoice).toHaveBeenCalledWith(staged);
      expect(removeUserVoice).not.toHaveBeenCalledWith("natsume");
    });

    it("uploads nowhere when the provider changes during the pick, and removes the staged copy", async () => {
      const { pickVoiceImport, commitVoiceImport, speakerSelection, endpoints } = build(
        "https://api.fish.audio",
        "fish",
      );
      pickVoiceFile.mockImplementation(async (stagingId: string) => {
        endpoints.tts_provider = "irodori";
        return stagedUnder(stagingId);
      });

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "natsume");

      expect(upsertFishVoice).not.toHaveBeenCalled();
      expect(upsertVoice).not.toHaveBeenCalled();
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(removeUserVoice).toHaveBeenCalledWith(pickVoiceFile.mock.calls[0][0]);
    });

    it("commits nothing and leaves no folder when the server changes during the rename", async () => {
      upsertFishVoice.mockResolvedValue("model9");
      const { pickVoiceImport, commitVoiceImport, speakerSelection, endpoints } = build(
        "https://api.fish.audio",
        "fish",
      );
      renameUserVoice.mockImplementation(async () => {
        endpoints.tts_base_url = "https://fish.other";
        return "asset://localhost/app-data/references/model9/clip.wav";
      });

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "natsume");

      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(speakerSelection.select).not.toHaveBeenCalled();
      expect(removeUserVoice).toHaveBeenCalledWith("model9");
    });
  });

  describe("fish", () => {
    it("uploads the multipart import, moves the clip to the server-assigned _id and selects it", async () => {
      upsertFishVoice.mockResolvedValue("model_9");
      renameUserVoice.mockResolvedValue("asset://localhost/app-data/references/model_9/clip.wav");
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build(
        "https://api.fish.audio",
        "fish",
      );

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "My Voice");

      expect(upsertFishVoice).toHaveBeenCalledOnce();
      expect(upsertFishVoice.mock.calls[0][0]).toMatchObject({
        baseUrl: "https://api.fish.audio",
        name: "My Voice",
        refUrl: `asset://localhost/app-data/references/${staged}/clip.wav`,
      });
      expect(upsertVoice).not.toHaveBeenCalled();
      expect(renameUserVoice).toHaveBeenCalledWith(staged, "model_9");
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
      const { pickVoiceImport, commitVoiceImport, speakerSelection, endpoints } = build(
        "https://api.fish.audio",
        "fish",
      );
      upsertFishVoice.mockImplementation(async () => {
        endpoints.tts_provider = "irodori";
        return "model_9";
      });

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "My Voice");

      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(speakerSelection.select).not.toHaveBeenCalled();
      expect(renameUserVoice).not.toHaveBeenCalled();
    });

    it("cleans up the orphan copy and rethrows when the upload fails", async () => {
      upsertFishVoice.mockRejectedValue(new Error("HTTP 400: invalid audio"));
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build(
        "https://api.fish.audio",
        "fish",
      );

      const staged = (await pickVoiceImport())!.stagedId;
      await expect(commitVoiceImport(staged, "My Voice")).rejects.toThrow("invalid audio");

      expect(removeUserVoice).toHaveBeenCalledWith(pickVoiceFile.mock.calls[0][0]);
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(speakerSelection.select).not.toHaveBeenCalled();
    });
  });

  describe("pickVoiceImport", () => {
    it("returns null on cancel without staging anything", async () => {
      pickVoiceFile.mockResolvedValue(null);
      const { pickVoiceImport } = build("http://localhost:8091");

      expect(await pickVoiceImport()).toBeNull();
      expect(removeUserVoice).not.toHaveBeenCalled();
    });

    it("stages the copy under import-<uuid> and returns its id with the seed name", async () => {
      pickVoiceFile.mockResolvedValue({
        staged: { id: "import-9", label: "import-9", ref_url: "asset://x", source: "user" },
        seedName: "ナツメ",
      });
      const { pickVoiceImport } = build("http://localhost:8091");

      const out = await pickVoiceImport();

      expect(pickVoiceFile).toHaveBeenCalledWith(
        expect.stringMatching(/^import-[0-9a-f-]{36}$/),
      );
      expect(out!.stagedId).toMatch(/^import-[0-9a-f-]{36}$/);
      expect(out!.seedName).toBe("ナツメ");
      expect(out!.discard).toBeInstanceOf(Function);
    });

    it("discard() removes the staged copy under its id", async () => {
      const { pickVoiceImport } = build("http://localhost:8091");

      const picked = await pickVoiceImport();
      await picked!.discard();

      expect(removeUserVoice).toHaveBeenCalledWith(pickVoiceFile.mock.calls[0][0]);
    });
  });

  describe("commitVoiceImport", () => {
    it("uploads the clip with upsertVoice and adds + selects the option", async () => {
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "myvoice");

      expect(upsertVoice).toHaveBeenCalledOnce();
      expect(upsertVoice.mock.calls[0][0]).toMatchObject({
        baseUrl: "http://localhost:8091",
        id: "myvoice",
      });
      expect(speakerSelection.addUserOption).toHaveBeenCalledWith({
        ...IMPORTED,
        label: "myvoice",
        revision: 1,
        provider: "irodori",
      });
      expect(speakerSelection.select).toHaveBeenCalledWith("myvoice");
    });

    it("derives the id from a typed name that is not itself an id, and keeps the name as the label", async () => {
      const id = voiceIdFromName("My Voice");
      renameUserVoice.mockResolvedValue(`asset://localhost/app-data/references/${id}/clip.wav`);
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "My Voice");

      expect(id).not.toBe("My Voice");
      expect(upsertVoice.mock.calls[0][0]).toMatchObject({ id, name: "My Voice" });
      expect(removeUserVoice).toHaveBeenCalledWith(id);
      expect(renameUserVoice).toHaveBeenCalledWith(staged, id);
      expect(speakerSelection.addUserOption).toHaveBeenCalledWith(
        expect.objectContaining({ id, label: "My Voice" }),
      );
    });

    it("stores the replaced clip of a same-name re-import when the server changes during the move, selecting nothing", async () => {
      const stored: SpeakerOption = { ...IMPORTED, provider: "irodori" };
      const { pickVoiceImport, commitVoiceImport, speakerSelection, endpoints } = build(
        "http://localhost:8091",
        "irodori",
        [stored],
      );
      renameUserVoice.mockImplementation(async () => {
        endpoints.tts_base_url = "http://localhost:9999";
        return "asset://localhost/app-data/references/myvoice/clip.mp3";
      });

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "myvoice");

      expect(speakerSelection.addUserOption).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "myvoice",
          ref_url: "asset://localhost/app-data/references/myvoice/clip.mp3",
        }),
      );
      expect(speakerSelection.select).not.toHaveBeenCalled();
      expect(removeUserVoice).toHaveBeenCalledTimes(1);
    });

    it("hands upsertVoice the TTS key resolver so a gated server still accepts the upload", async () => {
      const getApiKey = vi.fn().mockResolvedValue("sk-tts");
      const { pickVoiceImport, commitVoiceImport } = createVoiceImportFlow({
        getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
        getApiKey,
        speakerSelection: fakeStore(),
        log: noopLog,
      });

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "My Voice");

      expect(upsertVoice.mock.calls[0][0]).toMatchObject({ getApiKey });
    });

    it("bumps the revision on top of whatever is already stored for that id, so a re-import invalidates other windows' filler cache", async () => {
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build("http://localhost:8091");
      speakerSelection.list.mockReturnValue([{ ...IMPORTED, revision: 3 }]);

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "myvoice");

      expect(speakerSelection.addUserOption).toHaveBeenCalledWith({
        ...IMPORTED,
        label: "myvoice",
        revision: 4,
        provider: "irodori",
      });
    });

    // upsertVoice is itself create-or-replace, so the flow has nothing to branch on — a flaked
    // list call (it resolves to null rather than throwing) can never skip the upload.
    it("never consults listVoices — a flaked list cannot skip the upload", async () => {
      listVoices.mockResolvedValue(null); // as if the server list call failed
      const { pickVoiceImport, commitVoiceImport } = build("http://localhost:8091");

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "My Voice");

      expect(listVoices).not.toHaveBeenCalled();
      expect(upsertVoice).toHaveBeenCalledOnce();
    });

    it("overwriting an existing name still uploads (no id-existence short circuit)", async () => {
      listVoices.mockResolvedValue(["myvoice"]); // server already has it — an explicit overwrite
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "myvoice");

      expect(upsertVoice).toHaveBeenCalledOnce();
      expect(speakerSelection.select).toHaveBeenCalledWith("myvoice");
    });

    it("cleans up the orphan copy and rethrows when the upload fails, leaving the store untouched", async () => {
      upsertVoice.mockRejectedValue(new Error("server down"));
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      const staged = (await pickVoiceImport())!.stagedId;
      await expect(commitVoiceImport(staged, "My Voice")).rejects.toThrow("server down");

      expect(removeUserVoice).toHaveBeenCalledWith(pickVoiceFile.mock.calls[0][0]);
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(speakerSelection.select).not.toHaveBeenCalled();
    });

    it("keeps the stored voice's folder when a same-name re-import fails, removing only the staged copy", async () => {
      upsertVoice.mockRejectedValue(new Error("server down"));
      const { pickVoiceImport, commitVoiceImport } = build("http://localhost:8091", "irodori", [
        { ...IMPORTED, provider: "irodori" },
      ]);

      const staged = (await pickVoiceImport())!.stagedId;
      await expect(commitVoiceImport(staged, "myvoice")).rejects.toThrow("server down");

      expect(removeUserVoice).not.toHaveBeenCalledWith("myvoice");
      expect(removeUserVoice.mock.calls).toEqual([[pickVoiceFile.mock.calls[0][0]]]);
      expect(renameUserVoice).not.toHaveBeenCalled();
    });

    it("uploads under the name-derived id, then moves the staged clip over that id's folder", async () => {
      renameUserVoice.mockResolvedValue("asset://localhost/app-data/references/myvoice/moved.wav");
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build(
        "http://localhost:8091",
        "irodori",
      );

      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "myvoice");

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

    it("refuses a blank name under a provider that keeps the caller's id, removing the staged copy", async () => {
      const { pickVoiceImport, commitVoiceImport } = build("http://localhost:8091", "irodori");

      const staged = (await pickVoiceImport())!.stagedId;
      await expect(commitVoiceImport(staged, "  ")).rejects.toThrow("voice name required");

      expect(removeUserVoice).toHaveBeenCalledWith(staged);
    });

    it("throws and removes the staged copy when tts_base_url is unset", async () => {
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build(undefined);

      const staged = (await pickVoiceImport())!.stagedId;
      await expect(commitVoiceImport(staged, "My Voice")).rejects.toThrow("tts_base_url");

      expect(removeUserVoice).toHaveBeenCalledWith(staged);
      expect(upsertVoice).not.toHaveBeenCalled();
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
    });

    it("refuses an import under a provider that takes no uploaded voices, removing the staged copy", async () => {
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build(
        "https://api.openai.com",
        "openai",
      );

      const staged = (await pickVoiceImport())!.stagedId;
      await expect(commitVoiceImport(staged, "My Voice")).rejects.toThrow("openai");

      expect(removeUserVoice).toHaveBeenCalledWith(staged);
      expect(upsertVoice).not.toHaveBeenCalled();
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
    });

    it("refuses an Irodori import whose id another provider's voice holds, removing the staged copy", async () => {
      const { pickVoiceImport, commitVoiceImport, speakerSelection } = build(
        "http://localhost:8091",
        "irodori",
        [{ id: "natsume", label: "natsume", ref_url: "", source: "user", provider: "fish" }],
      );

      const staged = (await pickVoiceImport())!.stagedId;
      await expect(commitVoiceImport(staged, "natsume")).rejects.toThrow("natsume");

      expect(removeUserVoice).toHaveBeenCalledWith(staged);
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
    });

    // fakeStore() above doesn't exercise createSelectionStore's own notify logic, so it can't
    // catch a regression there — this uses the real store to pin the #506 scenario: re-importing
    // the voice that is already the active selection.
    it("notifies the real store's own subscribers when re-importing the id that is already active", async () => {
      const speakerSelection = createSpeakerSelection({ defaultValue: "" });
      speakerSelection.addUserOption({ ...IMPORTED, provider: "irodori" });
      speakerSelection.select(IMPORTED.id);
      const onChange = vi.fn();
      speakerSelection.subscribe(onChange);

      // Same name, same id, already active — select() alone is a no-op here (unchanged active id),
      // so addUserOption is the only thing that can wake other windows.
      const { pickVoiceImport, commitVoiceImport } = createVoiceImportFlow({
        getEndpoints: () => ({ tts_base_url: "http://localhost:8091" }),
        speakerSelection,
        log: noopLog,
      });
      const staged = (await pickVoiceImport())!.stagedId;
      await commitVoiceImport(staged, "myvoice");

      expect(onChange).toHaveBeenCalled();
    });
  });
});
