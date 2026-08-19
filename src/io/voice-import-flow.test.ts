import { beforeEach, describe, expect, it, vi } from "vitest";

const { listVoices, upsertVoice } = vi.hoisted(() => ({
  listVoices: vi.fn().mockResolvedValue([]),
  upsertVoice: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./tts-voices", () => ({ listVoices, upsertVoice }));

const { selectFetch } = vi.hoisted(() => ({ selectFetch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./chat-client", () => ({ selectFetch }));

const { copyVoiceFile, pickVoiceFile, removeOrphanVoice, removeUserVoice } = vi.hoisted(() => ({
  copyVoiceFile: vi.fn(),
  pickVoiceFile: vi.fn(),
  removeOrphanVoice: vi.fn(async (id: string, remove: (id: string) => Promise<void>) => {
    await remove(id);
  }),
  removeUserVoice: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./voice-import", () => ({
  copyVoiceFile,
  pickVoiceFile,
  removeOrphanVoice,
  removeUserVoice,
  fileStemFromPath: (path: string) => {
    const base = path.split(/[\\/]/).pop() ?? path;
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
  },
}));

import { createSpeakerSelection, type SpeakerOption } from "./speaker-selection";
import { createVoiceImportFlow } from "./voice-import-flow";

const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const IMPORTED = {
  id: "myvoice",
  label: "My Voice",
  ref_url: "asset://localhost/app-data/references/myvoice/clip.wav",
  source: "user" as const,
};

function fakeStore() {
  return { list: vi.fn(() => [] as SpeakerOption[]), addUserOption: vi.fn(), select: vi.fn() };
}

// Explicit arg, no default — build(undefined) must mean "no base url", not "fall back to one".
function build(baseUrl: string | undefined) {
  const speakerSelection = fakeStore();
  const flow = createVoiceImportFlow({
    getTtsBaseUrl: () => baseUrl,
    speakerSelection,
    log: noopLog,
  });
  return { ...flow, speakerSelection };
}

describe("createVoiceImportFlow", () => {
  beforeEach(() => {
    listVoices.mockReset().mockResolvedValue([]);
    upsertVoice.mockReset().mockResolvedValue(undefined);
    copyVoiceFile.mockReset().mockResolvedValue(IMPORTED);
    pickVoiceFile.mockReset();
    removeOrphanVoice.mockClear();
    removeUserVoice.mockReset().mockResolvedValue(undefined);
    noopLog.error.mockClear();
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
      expect(speakerSelection.addUserOption).toHaveBeenCalledWith({ ...IMPORTED, revision: 1 });
      expect(speakerSelection.select).toHaveBeenCalledWith("myvoice");
    });

    it("hands upsertVoice the TTS key resolver so a gated server still accepts the upload", async () => {
      const getApiKey = vi.fn().mockResolvedValue("sk-tts");
      const { commitVoiceImport } = createVoiceImportFlow({
        getTtsBaseUrl: () => "http://localhost:8091",
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

      expect(speakerSelection.addUserOption).toHaveBeenCalledWith({ ...IMPORTED, revision: 4 });
    });

    // upsertVoice is itself create-or-replace, so the flow has nothing to branch on — a flaked
    // list call (it resolves to [] rather than throwing) can never skip the upload.
    it("never consults listVoices — a flaked list cannot skip the upload", async () => {
      listVoices.mockResolvedValue([]); // as if the server list call failed
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

    it("throws and cleans up when tts_base_url is unset", async () => {
      const { commitVoiceImport, speakerSelection } = build(undefined);

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "My Voice")).rejects.toThrow(
        "tts_base_url",
      );

      expect(upsertVoice).not.toHaveBeenCalled();
      expect(removeUserVoice).toHaveBeenCalledWith("myvoice");
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
        getTtsBaseUrl: () => "http://localhost:8091",
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
