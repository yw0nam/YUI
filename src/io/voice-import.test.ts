/**
 * voice-import.test.ts — bring-your-own-voice import module.
 *
 * Pins the contract for src/io/voice-import.ts: a thin TS layer over the dialog
 * plugin + the Rust `import_voice_file` / `remove_user_voice` commands. All deps are
 * injectable so the suite never touches a real Tauri runtime.
 */

import { describe, expect, it, vi } from "vitest";
import {
  importVoiceFromFile,
  removeOrphanVoice,
  removeUserVoice,
  type VoiceImportDeps,
} from "./voice-import";

function makeDeps(over: Partial<VoiceImportDeps> = {}): VoiceImportDeps {
  return {
    openDialog: vi.fn(async () => "/Users/me/Downloads/MyVoice.wav"),
    invoke: vi.fn(async () => ({
      id: "MyVoice",
      refPath: "/app-data/references/MyVoice/clip.wav",
    })) as unknown as VoiceImportDeps["invoke"],
    resolveRefUrl: vi.fn(async (p: string) => `asset://localhost/${p}`),
    ...over,
  };
}

describe("importVoiceFromFile — dialog cancel", () => {
  it("returns null when the picker is cancelled (open → null)", async () => {
    const deps = makeDeps({ openDialog: vi.fn(async () => null) });
    const out = await importVoiceFromFile(deps);
    expect(out).toBeNull();
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it("returns null when the picker yields an empty array (multi off, nothing chosen)", async () => {
    const deps = makeDeps({ openDialog: vi.fn(async () => [] as unknown as string) });
    const out = await importVoiceFromFile(deps);
    expect(out).toBeNull();
    expect(deps.invoke).not.toHaveBeenCalled();
  });
});

describe("importVoiceFromFile — successful pick", () => {
  it("passes Audio filter + multiple:false to the dialog (no directory key)", async () => {
    const deps = makeDeps();
    await importVoiceFromFile(deps);
    expect(deps.openDialog).toHaveBeenCalledWith({
      multiple: false,
      filters: [
        { name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "webm"] },
      ],
    });
  });

  it("invokes import_voice_file with the picked srcPath", async () => {
    const deps = makeDeps();
    await importVoiceFromFile(deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_voice_file", {
      srcPath: "/Users/me/Downloads/MyVoice.wav",
    });
  });

  it("returns a user SpeakerOption with ref_url from resolveRefUrl", async () => {
    const deps = makeDeps();
    const out = await importVoiceFromFile(deps);
    expect(out).toEqual({
      id: "MyVoice",
      label: "MyVoice",
      ref_url: "asset://localhost//app-data/references/MyVoice/clip.wav",
      source: "user",
    });
    expect(deps.resolveRefUrl).toHaveBeenCalledWith("/app-data/references/MyVoice/clip.wav");
  });

  it("uses the first entry when the dialog returns a single-element array", async () => {
    const deps = makeDeps({ openDialog: vi.fn(async () => ["/tmp/Cat.wav"] as unknown as string) });
    await importVoiceFromFile(deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_voice_file", { srcPath: "/tmp/Cat.wav" });
  });

  it("accepts the object form { path } some dialog versions return", async () => {
    const deps = makeDeps({
      openDialog: vi.fn(async () => ({ path: "/tmp/Dog.mp3" }) as unknown as string),
    });
    await importVoiceFromFile(deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_voice_file", { srcPath: "/tmp/Dog.mp3" });
  });
});

describe("removeUserVoice", () => {
  it("invokes remove_user_voice with the id", async () => {
    const invoke = vi.fn(async () => undefined);
    await removeUserVoice("MyVoice", { invoke: invoke as unknown as VoiceImportDeps["invoke"] });
    expect(invoke).toHaveBeenCalledWith("remove_user_voice", { id: "MyVoice" });
  });
});

describe("removeOrphanVoice — orphan cleanup surfaces failures (#162)", () => {
  it("attempts removal and resolves without calling onError on success", async () => {
    const remove = vi.fn(async () => {});
    const onError = vi.fn();
    await removeOrphanVoice("MyVoice", remove, onError);
    expect(remove).toHaveBeenCalledWith("MyVoice");
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces (does not swallow) a failed orphan removal via onError", async () => {
    const boom = new Error("native delete failed");
    const remove = vi.fn(async () => {
      throw boom;
    });
    const onError = vi.fn();
    await expect(removeOrphanVoice("MyVoice", remove, onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBe(boom);
  });
});
