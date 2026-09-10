/**
 * user-asset-import.test.ts — plumbing shared by the voice and VRM imports.
 *
 * pickedPath normalizes every dialog-result shape the plugin versions return, and
 * removeOrphanImport surfaces (never swallows) a failed orphan cleanup. What each
 * importer binds — picker filters, native command, returned option — is pinned in
 * voice-import.test.ts / vrm-import.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import { pickedPath, removeOrphanImport } from "./user-asset-import";

describe("pickedPath — dialog result shapes", () => {
  it("returns null for a null result (the picker was cancelled)", () => {
    expect(pickedPath(null)).toBeNull();
  });

  it("returns null when the picker yields an empty array (multi off, nothing chosen)", () => {
    expect(pickedPath([])).toBeNull();
  });

  it("uses the first entry when the dialog returns a single-element array", () => {
    expect(pickedPath(["/tmp/Cat.wav"])).toBe("/tmp/Cat.wav");
  });

  it("accepts the object form { path } some dialog versions return", () => {
    expect(pickedPath({ path: "/tmp/Dog.mp3" })).toBe("/tmp/Dog.mp3");
  });
});

describe("removeOrphanImport — orphan cleanup surfaces failures", () => {
  it("attempts removal and resolves without calling onError on success", async () => {
    const remove = vi.fn(async () => {});
    const onError = vi.fn();
    await removeOrphanImport("MyVoice", remove, onError);
    expect(remove).toHaveBeenCalledWith("MyVoice");
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces (does not swallow) a failed orphan removal via onError", async () => {
    const boom = new Error("native delete failed");
    const remove = vi.fn(async () => {
      throw boom;
    });
    const onError = vi.fn();
    // must not reject — the primary error is what rethrows; cleanup only surfaces.
    await expect(removeOrphanImport("MyVoice", remove, onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBe(boom);
  });
});
