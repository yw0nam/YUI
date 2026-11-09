/**
 * import-preset.test.ts — the preset-file import orchestration.
 *
 * Pins src/app/card-io/import-preset.ts: the copied voice's registration and its rollback,
 * the VRM list entry, the keys the new preset is created with, the one-shot notice across
 * the activation reload, and the rollback of exactly what the import created. Every dep is
 * a mock, so the suite never touches a real Tauri runtime or TTS server.
 */

import { describe, expect, it, vi } from "vitest";
import { readCard } from "../../config/validators/persona/read-card";
import type { Card } from "../../config/validators/persona/types";
import type { ImportedCard } from "../../io/assets/card/card-import";
import type { SpeakerOption } from "../../io/voice/voices/speaker-selection";
import type { CreatePresetFromCardInput } from "../../settings/preset/import-card-preset";
import { CARD_IMPORT_NOTICE_KEY, importPreset } from "./import-preset";

const card = (): Card =>
  readCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { name: "Mio", description: "bundle" },
  }).card;

const yuiCard = (over: Partial<ImportedCard> = {}): ImportedCard => ({
  card: card(),
  source: "yui",
  thumbnailTempId: "temp-1",
  ...over,
});

function memoryNotice(): Pick<Storage, "setItem" | "removeItem"> & { keys(): string[] } {
  const map = new Map<string, string>();
  return {
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

function fakeVrmSelection(bundledIds: string[] = ["carlotta"]) {
  const listed = bundledIds.map(
    (id): { id: string; label: string; url: string; source: "bundled" } => ({
      id,
      label: id,
      url: `/vrms/${id}.vrm`,
      source: "bundled",
    }),
  );
  return {
    list: vi.fn(() => listed.map((o) => ({ ...o }))),
    addUserOption: vi.fn((option: { id: string }) => void listed.push(option as never)),
    removeUserOption: vi.fn((id: string) => {
      const at = listed.findIndex((o) => o.id === id);
      if (at >= 0) listed.splice(at, 1);
    }),
  };
}

function baseDeps(imported: ImportedCard | null) {
  const notice = memoryNotice();
  return {
    importCard: vi.fn(async () => imported),
    registerCopiedVoice: vi.fn(async () => "reg-voice"),
    removeUserVoice: vi.fn(async () => {}),
    discardVoice: vi.fn(async () => {}),
    removeUserVrm: vi.fn(async () => {}),
    vrmSelection: fakeVrmSelection(),
    createPresetFromCard: vi.fn(async (_input: CreatePresetFromCardInput) => "new1"),
    noticeStorage: notice,
    notice,
  };
}

describe("importPreset", () => {
  it("registers the copied voice and writes its id as the new preset's speaker", async () => {
    const base = baseDeps(
      yuiCard({ voice: { stagedId: "import-9", refUrl: "asset://x/clip.wav", label: "Mio" } }),
    );
    await expect(importPreset(base)).resolves.toEqual({ presetId: "new1" });

    expect(base.registerCopiedVoice).toHaveBeenCalledWith(
      { id: "import-9", ref_url: "asset://x/clip.wav", source: "user" } satisfies SpeakerOption & {
        source: "user";
      },
      "Mio",
    );
    expect(base.createPresetFromCard).toHaveBeenCalledWith(
      expect.objectContaining({ speakerId: "reg-voice", vrmId: null }),
    );
    expect(base.notice.keys()).toEqual([]);
  });

  it("a voice that cannot register clears the speaker, removes the staged folder and leaves the notice", async () => {
    const base = baseDeps(
      yuiCard({ voice: { stagedId: "import-9", refUrl: "asset://x/clip.wav", label: "Mio" } }),
    );
    const deps = {
      ...base,
      registerCopiedVoice: vi.fn(async () => {
        throw new Error("voice import requires tts_base_url");
      }),
    };
    await expect(importPreset(deps)).resolves.toEqual({ presetId: "new1" });

    expect(base.removeUserVoice).toHaveBeenCalledWith("import-9");
    expect(base.createPresetFromCard).toHaveBeenCalledWith(
      expect.objectContaining({ speakerId: null }),
    );
    expect(base.notice.keys()).toEqual([CARD_IMPORT_NOTICE_KEY]);
  });

  it("adds a user vrm to the list and writes it as the new preset's vrm", async () => {
    const base = baseDeps(
      yuiCard({ vrm: { kind: "user", id: "mio_vrm", url: "asset://x/model.vrm" } }),
    );
    await expect(importPreset(base)).resolves.toEqual({ presetId: "new1" });

    expect(base.vrmSelection.addUserOption).toHaveBeenCalledWith({
      id: "mio_vrm",
      label: "mio_vrm",
      url: "asset://x/model.vrm",
      source: "user",
    });
    expect(base.createPresetFromCard).toHaveBeenCalledWith(
      expect.objectContaining({ vrmId: "mio_vrm" }),
    );
  });

  it("a bundled vrm the list does not hold writes no vrm id", async () => {
    const base = baseDeps(yuiCard({ vrm: { kind: "bundled", id: "aria" } }));
    await expect(importPreset(base)).resolves.toEqual({ presetId: "new1" });

    expect(base.vrmSelection.addUserOption).not.toHaveBeenCalled();
    expect(base.createPresetFromCard).toHaveBeenCalledWith(
      expect.objectContaining({ vrmId: null }),
    );
  });

  it("a card-only preset file clears the copied vrm and speaker keys", async () => {
    const base = baseDeps(
      yuiCard({
        crop: { x: 0.25, y: 0, size: 0.5 },
      }),
    );
    await expect(importPreset(base)).resolves.toEqual({ presetId: "new1" });

    expect(base.importCard).toHaveBeenCalledWith(["carlotta"], expect.stringMatching(/^import-/));
    expect(base.createPresetFromCard).toHaveBeenCalledWith(
      expect.objectContaining({
        card: card(),
        thumbnailTempId: "temp-1",
        crop: { x: 0.25, y: 0, size: 0.5 },
        vrmId: null,
        speakerId: null,
      }),
    );
  });

  it("a json import passes no vrm or speaker id", async () => {
    const base = baseDeps({ card: card(), source: "json" });
    await expect(importPreset(base)).resolves.toEqual({ presetId: "new1" });

    const input = base.createPresetFromCard.mock.calls[0][0];
    expect("vrmId" in input).toBe(false);
    expect("speakerId" in input).toBe(false);
  });

  it("a failed preset creation removes the vrm, the registered voice and the notice", async () => {
    const base = baseDeps(
      yuiCard({
        vrm: { kind: "user", id: "mio_vrm", url: "asset://x/model.vrm" },
        voice: { stagedId: "import-9", refUrl: "asset://x/clip.wav", label: "Mio" },
      }),
    );
    const deps = {
      ...base,
      createPresetFromCard: vi.fn(async () => {
        throw new Error("preset_create_failed");
      }),
    };
    await expect(importPreset(deps)).rejects.toThrow("preset_create_failed");

    expect(base.removeUserVrm).toHaveBeenCalledWith("mio_vrm");
    expect(base.vrmSelection.removeUserOption).toHaveBeenCalledWith("mio_vrm");
    expect(base.discardVoice).toHaveBeenCalledWith("reg-voice");
    expect(base.notice.keys()).toEqual([]);
  });
});
