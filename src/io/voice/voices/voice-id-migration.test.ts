import { describe, expect, it, vi } from "vitest";
import { voiceIdFromName } from "../../assets/safe-id";
import { createSpeakerSelection, type SpeakerOption } from "./speaker-selection";
import { migrateUserVoiceIds } from "./voice-id-migration";
import { removeUserVoice, renameUserVoice, type VoiceCopyDeps } from "./voice-import";

function makeStore(users: SpeakerOption[], selected: string | null) {
  let persisted = users;
  let override = selected;
  const store = createSpeakerSelection({
    defaultValue: "",
    storage: { load: () => override, save: (id) => (override = id) },
    userStorage: { load: () => persisted, save: (list) => (persisted = list) },
  });
  return { store, persisted: () => persisted, override: () => override };
}

/** Fake Tauri `invoke` that records every `rename_user_voice` / `remove_user_voice` call. */
function fakeVoiceDeps(fail = false) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const deps: VoiceCopyDeps = {
    invoke: (async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      if (fail) throw new Error("voice id taken");
      return { id: args?.to, refPath: `/app-data/references/${args?.to}/clip.wav` };
    }) as VoiceCopyDeps["invoke"],
    resolveRefUrl: async (p) => `asset://localhost${p}`,
  };
  return { deps, calls };
}

const log = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function migrate(
  store: ReturnType<typeof createSpeakerSelection>,
  deps: VoiceCopyDeps,
  logger = log(),
): Promise<void> {
  return migrateUserVoiceIds({
    speakerSelection: store,
    renameUserVoice: (from, to) => renameUserVoice(from, to, deps),
    removeUserVoice: (id) => removeUserVoice(id, deps),
    log: logger,
  });
}

describe("migrateUserVoiceIds", () => {
  it("moves a non-ASCII voice to its ASCII id, keeping its label and selection", async () => {
    const { store, persisted, override } = makeStore(
      [{ id: "芳乃", label: "芳乃", ref_url: "asset://old", source: "user", revision: 2 }],
      "芳乃",
    );
    const { deps, calls } = fakeVoiceDeps();
    const newId = voiceIdFromName("芳乃");

    await migrate(store, deps);

    expect(calls).toEqual([{ cmd: "rename_user_voice", args: { from: "芳乃", to: newId } }]);
    expect(persisted()).toEqual([
      {
        id: newId,
        label: "芳乃",
        ref_url: `asset://localhost/app-data/references/${newId}/clip.wav`,
        source: "user",
        revision: 2,
      },
    ]);
    expect(store.getActiveId()).toBe(newId);
    expect(override()).toBe(newId);
  });

  it("drops a non-ASCII voice whose ASCII id is already imported, selecting that one", async () => {
    const newId = voiceIdFromName("芳乃");
    const current: SpeakerOption = {
      id: newId,
      label: "芳乃",
      ref_url: "asset://new",
      source: "user",
      revision: 4,
    };
    const { store, persisted, override } = makeStore(
      [{ id: "芳乃", label: "芳乃", ref_url: "asset://old", source: "user" }, current],
      "芳乃",
    );
    const { deps, calls } = fakeVoiceDeps();

    await migrate(store, deps);

    expect(calls).toEqual([{ cmd: "remove_user_voice", args: { id: "芳乃" } }]);
    expect(persisted()).toEqual([current]);
    expect(override()).toBe(newId);
  });

  it("leaves an ASCII voice untouched", async () => {
    const users: SpeakerOption[] = [
      { id: "Cat", label: "Cat", ref_url: "asset://cat", source: "user" },
    ];
    const { store, persisted } = makeStore(users, "Cat");
    const { deps, calls } = fakeVoiceDeps();

    await migrate(store, deps);

    expect(calls).toEqual([]);
    expect(persisted()).toBe(users);
  });

  it("keeps the voice as it is and logs when the rename fails", async () => {
    const users: SpeakerOption[] = [
      { id: "希", label: "希", ref_url: "asset://nozomi", source: "user" },
    ];
    const { store, persisted, override } = makeStore(users, "希");
    const { deps } = fakeVoiceDeps(true);
    const logger = log();

    await migrate(store, deps, logger);

    expect(persisted()).toBe(users);
    expect(override()).toBe("希");
    expect(logger.warn).toHaveBeenCalledWith("voice_id_migration_failed", {
      id: "希",
      error: "Error: voice id taken",
    });
  });
});
