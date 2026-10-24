/**
 * voice-import.test.ts — bring-your-own-voice import module.
 *
 * Pins the contract for src/io/voice/voices/voice-import.ts: a thin TS layer over the Rust
 * `import_voice_file` (which opens the OS picker and stages the copy) / `remove_user_voice`
 * commands. pickVoiceFile stages the copy under the caller's staging id and returns the picked
 * file's stem to seed the naming row. All deps are injectable so the suite never touches a real
 * Tauri runtime.
 */

import { describe, expect, it, vi } from "vitest";
import { pickVoiceFile, removeUserVoice, type VoiceImportDeps } from "./voice-import";

function makeImportDeps(over: Partial<VoiceImportDeps> = {}): VoiceImportDeps {
  return {
    invoke: vi.fn(async () => ({
      id: "import-x",
      refPath: "/app-data/references/import-x/clip.wav",
      seedName: "MyVoice",
    })) as unknown as VoiceImportDeps["invoke"],
    resolveRefUrl: vi.fn(async (p: string) => `asset://localhost/${p}`),
    ...over,
  };
}

describe("pickVoiceFile", () => {
  it("returns null when invoke resolves null, without resolving a ref url", async () => {
    const deps = makeImportDeps({
      invoke: vi.fn(async () => null) as unknown as VoiceImportDeps["invoke"],
    });
    const out = await pickVoiceFile("import-x", deps);
    expect(out).toBeNull();
    expect(deps.resolveRefUrl).not.toHaveBeenCalled();
  });

  it("invokes import_voice_file with the staging id and returns the staged copy plus the seed", async () => {
    const deps = makeImportDeps();
    const out = await pickVoiceFile("import-x", deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_voice_file", { stagingId: "import-x" });
    expect(out).toEqual({
      staged: {
        id: "import-x",
        label: "import-x",
        ref_url: "asset://localhost//app-data/references/import-x/clip.wav",
        source: "user",
      },
      seedName: "MyVoice",
    });
    expect(deps.resolveRefUrl).toHaveBeenCalledWith("/app-data/references/import-x/clip.wav");
  });

  it("a failing ref-url resolve removes the staged copy and rethrows", async () => {
    const deps = makeImportDeps({
      resolveRefUrl: vi.fn(async () => {
        throw new Error("no asset url");
      }),
    });
    await expect(pickVoiceFile("import-x", deps)).rejects.toThrow("no asset url");
    expect(deps.invoke).toHaveBeenCalledWith("remove_user_voice", { id: "import-x" });
  });
});

describe("removeUserVoice", () => {
  it("invokes remove_user_voice with the id", async () => {
    const invoke = vi.fn(async () => undefined);
    await removeUserVoice("MyVoice", { invoke: invoke as unknown as VoiceImportDeps["invoke"] });
    expect(invoke).toHaveBeenCalledWith("remove_user_voice", { id: "MyVoice" });
  });
});
