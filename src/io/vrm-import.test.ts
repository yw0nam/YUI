/**
 * vrm-import.test.ts — TDD red for the bring-your-own-VRM import module (#147).
 *
 * Pins the contract for src/io/vrm-import.ts: a thin TS layer over the dialog
 * plugin + the Rust `import_vrm_file` / `remove_user_vrm` commands. All deps are
 * injectable so the suite never touches a real Tauri runtime.
 */

import { describe, it, expect, vi } from "vitest";
import { importVrmFromFile, removeUserVrm, removeOrphanVrm, type VrmImportDeps } from "./vrm-import";

function makeDeps(over: Partial<VrmImportDeps> = {}): VrmImportDeps {
  return {
    openDialog: vi.fn(async () => "/Users/me/Downloads/MyAvatar.vrm"),
    invoke: vi.fn(async () => ({ id: "MyAvatar", destPath: "/app-data/vrms/MyAvatar.vrm" })),
    convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURI(p)}`),
    ...over,
  };
}

describe("importVrmFromFile — dialog cancel", () => {
  it("returns null when the picker is cancelled (open → null)", async () => {
    const deps = makeDeps({ openDialog: vi.fn(async () => null) });
    const out = await importVrmFromFile(deps);
    expect(out).toBeNull();
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it("returns null when the picker yields an empty array (multi off, nothing chosen)", async () => {
    const deps = makeDeps({ openDialog: vi.fn(async () => [] as unknown as string) });
    const out = await importVrmFromFile(deps);
    expect(out).toBeNull();
    expect(deps.invoke).not.toHaveBeenCalled();
  });
});

describe("importVrmFromFile — successful pick", () => {
  it("passes VRM filter + single-select to the dialog", async () => {
    const deps = makeDeps();
    await importVrmFromFile(deps);
    expect(deps.openDialog).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: [{ name: "VRM", extensions: ["vrm"] }],
    });
  });

  it("invokes import_vrm_file with the picked srcPath", async () => {
    const deps = makeDeps();
    await importVrmFromFile(deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_vrm_file", {
      srcPath: "/Users/me/Downloads/MyAvatar.vrm",
    });
  });

  it("returns a user AvatarOption with a convertFileSrc'd url", async () => {
    const deps = makeDeps();
    const out = await importVrmFromFile(deps);
    expect(out).toEqual({
      id: "MyAvatar",
      label: "MyAvatar",
      url: "asset://localhost/" + encodeURI("/app-data/vrms/MyAvatar.vrm"),
      source: "user",
    });
    expect(deps.convertFileSrc).toHaveBeenCalledWith("/app-data/vrms/MyAvatar.vrm");
  });

  it("uses the first entry when the dialog returns a single-element array", async () => {
    const deps = makeDeps({ openDialog: vi.fn(async () => ["/tmp/Cat.vrm"] as unknown as string) });
    await importVrmFromFile(deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_vrm_file", { srcPath: "/tmp/Cat.vrm" });
  });

  it("accepts the object form { path } some dialog versions return", async () => {
    const deps = makeDeps({
      openDialog: vi.fn(async () => ({ path: "/tmp/Dog.vrm" }) as unknown as string),
    });
    await importVrmFromFile(deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_vrm_file", { srcPath: "/tmp/Dog.vrm" });
  });
});

describe("removeUserVrm", () => {
  it("invokes remove_user_vrm with the id", async () => {
    const invoke = vi.fn(async () => undefined);
    await removeUserVrm("MyAvatar", { invoke });
    expect(invoke).toHaveBeenCalledWith("remove_user_vrm", { id: "MyAvatar" });
  });
});

describe("removeOrphanVrm — orphan cleanup surfaces failures (#162)", () => {
  it("attempts removal and resolves without calling onError on success", async () => {
    const remove = vi.fn(async () => {});
    const onError = vi.fn();
    await removeOrphanVrm("MyAvatar", remove, onError);
    expect(remove).toHaveBeenCalledWith("MyAvatar");
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces (does not swallow) a failed orphan removal via onError", async () => {
    const boom = new Error("native delete failed");
    const remove = vi.fn(async () => {
      throw boom;
    });
    const onError = vi.fn();
    // must not reject — the primary error is what rethrows; cleanup only surfaces.
    await expect(removeOrphanVrm("MyAvatar", remove, onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBe(boom);
  });
});
