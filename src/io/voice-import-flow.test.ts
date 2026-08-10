import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureRegistered, listVoices, updateVoice } = vi.hoisted(() => ({
  ensureRegistered: vi.fn().mockResolvedValue(undefined),
  listVoices: vi.fn().mockResolvedValue([]),
  updateVoice: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./irodori-voices", () => ({ ensureRegistered, listVoices, updateVoice }));

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

import type { SpeakerOption } from "./speaker-selection";
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
    getIrodoriBaseUrl: () => baseUrl,
    speakerSelection,
    log: noopLog,
  });
  return { ...flow, speakerSelection };
}

describe("createVoiceImportFlow", () => {
  beforeEach(() => {
    ensureRegistered.mockReset().mockResolvedValue(undefined);
    listVoices.mockReset().mockResolvedValue([]);
    updateVoice.mockReset().mockResolvedValue(undefined);
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
    it("uploads the clip with updateVoice (PUT upserts) and adds + selects the option", async () => {
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(copyVoiceFile).toHaveBeenCalledWith("/tmp/MyVoice.wav", "My Voice");
      expect(updateVoice).toHaveBeenCalledOnce();
      expect(updateVoice.mock.calls[0][0]).toMatchObject({
        baseUrl: "http://localhost:8091",
        id: "myvoice",
        refUrl: IMPORTED.ref_url,
      });
      expect(speakerSelection.addUserOption).toHaveBeenCalledWith({ ...IMPORTED, revision: 1 });
      expect(speakerSelection.select).toHaveBeenCalledWith("myvoice");
    });

    it("bumps the revision on top of whatever is already stored for that id, so a re-import invalidates other windows' filler cache", async () => {
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091");
      speakerSelection.list.mockReturnValue([{ ...IMPORTED, revision: 3 }]);

      await commitVoiceImport("/tmp/Replacement.wav", "My Voice");

      expect(speakerSelection.addUserOption).toHaveBeenCalledWith({ ...IMPORTED, revision: 4 });
    });

    // Regression: deciding PUT-vs-POST from listVoices routed an overwrite into ensureRegistered
    // whenever the list call flaked (it resolves to [] rather than throwing). ensureRegistered
    // returns early for an already-registered id AND memoizes per baseUrl::id, so the replacement
    // clip silently never reached the server. PUT is an upsert — there is nothing to branch on.
    it("never consults listVoices or ensureRegistered — a flaked list cannot skip the upload", async () => {
      listVoices.mockResolvedValue([]); // as if the server list call failed
      const { commitVoiceImport } = build("http://localhost:8091");

      await commitVoiceImport("/tmp/MyVoice.wav", "My Voice");

      expect(listVoices).not.toHaveBeenCalled();
      expect(ensureRegistered).not.toHaveBeenCalled();
      expect(updateVoice).toHaveBeenCalledOnce();
    });

    it("overwriting an existing name still uploads (no id-existence short circuit)", async () => {
      listVoices.mockResolvedValue(["myvoice"]); // server already has it — an explicit overwrite
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      await commitVoiceImport("/tmp/Replacement.wav", "My Voice");

      expect(updateVoice).toHaveBeenCalledOnce();
      expect(speakerSelection.select).toHaveBeenCalledWith("myvoice");
    });

    it("cleans up the orphan copy and rethrows when the upload fails, leaving the store untouched", async () => {
      updateVoice.mockRejectedValue(new Error("server down"));
      const { commitVoiceImport, speakerSelection } = build("http://localhost:8091");

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "My Voice")).rejects.toThrow(
        "server down",
      );

      expect(removeUserVoice).toHaveBeenCalledWith("myvoice");
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
      expect(speakerSelection.select).not.toHaveBeenCalled();
    });

    it("throws and cleans up when irodori_base_url is unset", async () => {
      const { commitVoiceImport, speakerSelection } = build(undefined);

      await expect(commitVoiceImport("/tmp/MyVoice.wav", "My Voice")).rejects.toThrow(
        "irodori_base_url",
      );

      expect(updateVoice).not.toHaveBeenCalled();
      expect(removeUserVoice).toHaveBeenCalledWith("myvoice");
      expect(speakerSelection.addUserOption).not.toHaveBeenCalled();
    });
  });
});
