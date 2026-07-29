/**
 * voice-import.test.ts — bring-your-own-voice import module.
 *
 * Pins the contract for src/io/voice-import.ts: a thin TS layer over the dialog
 * plugin + the Rust `import_voice_file` / `remove_user_voice` commands. Import is
 * split into pickVoiceFile (OS picker, path only) and copyVoiceFile (copy + register
 * under a caller-supplied name) so a naming row can sit between them. All deps are
 * injectable so the suite never touches a real Tauri runtime.
 */

import { describe, expect, it, vi } from "vitest";
import {
  copyVoiceFile,
  fileStemFromPath,
  pickVoiceFile,
  removeOrphanVoice,
  removeUserVoice,
  type VoiceCopyDeps,
  type VoicePickDeps,
} from "./voice-import";

function makePickDeps(over: Partial<VoicePickDeps> = {}): VoicePickDeps {
  return {
    openDialog: vi.fn(async () => "/Users/me/Downloads/MyVoice.wav"),
    ...over,
  };
}

function makeCopyDeps(over: Partial<VoiceCopyDeps> = {}): VoiceCopyDeps {
  return {
    invoke: vi.fn(async () => ({
      id: "MyVoice",
      refPath: "/app-data/references/MyVoice/clip.wav",
    })) as unknown as VoiceCopyDeps["invoke"],
    resolveRefUrl: vi.fn(async (p: string) => `asset://localhost/${p}`),
    ...over,
  };
}

describe("pickVoiceFile — dialog cancel", () => {
  it("returns null when the picker is cancelled (open → null)", async () => {
    const deps = makePickDeps({ openDialog: vi.fn(async () => null) });
    const out = await pickVoiceFile(deps);
    expect(out).toBeNull();
  });

  it("returns null when the picker yields an empty array (multi off, nothing chosen)", async () => {
    const deps = makePickDeps({ openDialog: vi.fn(async () => [] as unknown as string) });
    const out = await pickVoiceFile(deps);
    expect(out).toBeNull();
  });
});

describe("pickVoiceFile — successful pick", () => {
  it("passes Audio filter + multiple:false to the dialog (no directory key)", async () => {
    const deps = makePickDeps();
    await pickVoiceFile(deps);
    expect(deps.openDialog).toHaveBeenCalledWith({
      multiple: false,
      filters: [
        { name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "webm"] },
      ],
    });
  });

  it("returns the picked source path (nothing copied yet)", async () => {
    const deps = makePickDeps();
    const out = await pickVoiceFile(deps);
    expect(out).toBe("/Users/me/Downloads/MyVoice.wav");
  });

  it("uses the first entry when the dialog returns a single-element array", async () => {
    const deps = makePickDeps({ openDialog: vi.fn(async () => ["/tmp/Cat.wav"] as unknown as string) });
    const out = await pickVoiceFile(deps);
    expect(out).toBe("/tmp/Cat.wav");
  });

  it("accepts the object form { path } some dialog versions return", async () => {
    const deps = makePickDeps({
      openDialog: vi.fn(async () => ({ path: "/tmp/Dog.mp3" }) as unknown as string),
    });
    const out = await pickVoiceFile(deps);
    expect(out).toBe("/tmp/Dog.mp3");
  });
});

describe("fileStemFromPath", () => {
  it("strips the directory and extension", () => {
    expect(fileStemFromPath("/Users/me/Downloads/MyVoice.wav")).toBe("MyVoice");
  });

  it("handles a Windows-style backslash path", () => {
    expect(fileStemFromPath("C:\\Users\\me\\Natsume.mp3")).toBe("Natsume");
  });

  it("keeps a UTF-8 stem verbatim", () => {
    expect(fileStemFromPath("/Users/me/ナツメ.mp3")).toBe("ナツメ");
  });

  it("keeps interior dots, only stripping the final extension", () => {
    expect(fileStemFromPath("/Users/me/My.Voice.v2.wav")).toBe("My.Voice.v2");
  });

  it("returns the whole basename when there is no extension", () => {
    expect(fileStemFromPath("/Users/me/noext")).toBe("noext");
  });
});

describe("copyVoiceFile", () => {
  it("invokes import_voice_file with the srcPath and the typed name", async () => {
    const deps = makeCopyDeps();
    await copyVoiceFile("/Users/me/Downloads/MyVoice.wav", "MyVoice", deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_voice_file", {
      srcPath: "/Users/me/Downloads/MyVoice.wav",
      desiredName: "MyVoice",
    });
  });

  it("returns a user SpeakerOption with ref_url from resolveRefUrl and label = id", async () => {
    const deps = makeCopyDeps();
    const out = await copyVoiceFile("/Users/me/Downloads/MyVoice.wav", "MyVoice", deps);
    expect(out).toEqual({
      id: "MyVoice",
      label: "MyVoice",
      ref_url: "asset://localhost//app-data/references/MyVoice/clip.wav",
      source: "user",
    });
    expect(deps.resolveRefUrl).toHaveBeenCalledWith("/app-data/references/MyVoice/clip.wav");
  });

  it("reflects a sanitized id back (label follows the id the native side actually used)", async () => {
    const deps = makeCopyDeps({
      invoke: vi.fn(async () => ({
        id: "my_voice",
        refPath: "/app-data/references/my_voice/clip.wav",
      })) as unknown as VoiceCopyDeps["invoke"],
    });
    const out = await copyVoiceFile("/tmp/x.wav", "my/voice", deps);
    expect(out.id).toBe("my_voice");
    expect(out.label).toBe("my_voice");
  });
});

describe("removeUserVoice", () => {
  it("invokes remove_user_voice with the id", async () => {
    const invoke = vi.fn(async () => undefined);
    await removeUserVoice("MyVoice", { invoke: invoke as unknown as VoiceCopyDeps["invoke"] });
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
