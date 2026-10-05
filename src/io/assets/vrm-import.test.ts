/**
 * vrm-import.test.ts — bring-your-own-VRM import module.
 *
 * Pins the contract for src/io/assets/vrm-import.ts: a thin TS layer over the dialog
 * plugin + the Rust `import_vrm_file` / `remove_user_vrm` commands. All deps are
 * injectable so the suite never touches a real Tauri runtime.
 */

import { describe, expect, it, vi } from "vitest";
import type { AvatarOption } from "../../config/validators/avatar/types";
import { importVrmFromFile, removeUserVrm, type VrmImportDeps } from "./vrm-import";

/** The selection store as the import reads it: bundled options plus one imported one. */
const selection = {
  list: (): AvatarOption[] => [
    { id: "Sendagaya_Shino", label: "Shino", url: "/vrms/Sendagaya_Shino.vrm", source: "bundled" },
    { id: "Cat", label: "Cat", url: "asset://x/Cat.vrm", source: "user" },
  ],
};

function makeDeps(over: Partial<VrmImportDeps> = {}): VrmImportDeps {
  return {
    openDialog: vi.fn(async () => "/Users/me/Downloads/MyAvatar.vrm"),
    invoke: vi.fn(async () => ({
      id: "MyAvatar",
      destPath: "/app-data/vrms/MyAvatar.vrm",
    })) as unknown as VrmImportDeps["invoke"],
    convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURI(p)}`),
    ...over,
  };
}

describe("importVrmFromFile — dialog cancel", () => {
  it("returns null when the picker is cancelled (open → null)", async () => {
    const deps = makeDeps({ openDialog: vi.fn(async () => null) });
    const out = await importVrmFromFile(selection, deps);
    expect(out).toBeNull();
    expect(deps.invoke).not.toHaveBeenCalled();
  });
});

describe("importVrmFromFile — successful pick", () => {
  it("passes VRM filter + single-select to the dialog", async () => {
    const deps = makeDeps();
    await importVrmFromFile(selection, deps);
    expect(deps.openDialog).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: [{ name: "VRM", extensions: ["vrm"] }],
    });
  });

  it("invokes import_vrm_file with the picked srcPath and the bundled ids as reserved", async () => {
    const deps = makeDeps();
    await importVrmFromFile(selection, deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_vrm_file", {
      srcPath: "/Users/me/Downloads/MyAvatar.vrm",
      reservedIds: ["Sendagaya_Shino"],
    });
  });

  it("returns a user AvatarOption with a convertFileSrc'd url", async () => {
    const deps = makeDeps();
    const out = await importVrmFromFile(selection, deps);
    expect(out).toEqual({
      id: "MyAvatar",
      label: "MyAvatar",
      url: `asset://localhost/${encodeURI("/app-data/vrms/MyAvatar.vrm")}`,
      source: "user",
    });
    expect(deps.convertFileSrc).toHaveBeenCalledWith("/app-data/vrms/MyAvatar.vrm");
  });
});

describe("removeUserVrm", () => {
  it("invokes remove_user_vrm with the id", async () => {
    const invoke = vi.fn(async () => undefined);
    await removeUserVrm("MyAvatar", { invoke: invoke as unknown as VrmImportDeps["invoke"] });
    expect(invoke).toHaveBeenCalledWith("remove_user_vrm", { id: "MyAvatar" });
  });
});
