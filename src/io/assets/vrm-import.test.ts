/**
 * vrm-import.test.ts — bring-your-own-VRM import module.
 *
 * Pins the contract for src/io/assets/vrm-import.ts: a thin layer over the Rust
 * `import_vrm_file` (which opens the OS picker itself) / `remove_user_vrm` commands. All deps
 * are injectable so the suite never touches a real Tauri runtime.
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
    invoke: vi.fn(async () => ({
      id: "MyAvatar",
      destPath: "/app-data/vrms/MyAvatar.vrm",
    })) as unknown as VrmImportDeps["invoke"],
    convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURI(p)}`),
    ...over,
  };
}

describe("importVrmFromFile — dialog cancel", () => {
  it("returns null when invoke resolves null", async () => {
    const deps = makeDeps({
      invoke: vi.fn(async () => null) as unknown as VrmImportDeps["invoke"],
    });
    const out = await importVrmFromFile(selection, deps);
    expect(out).toBeNull();
    expect(deps.convertFileSrc).not.toHaveBeenCalled();
  });
});

describe("importVrmFromFile — successful pick", () => {
  it("invokes import_vrm_file with the bundled ids as reserved", async () => {
    const deps = makeDeps();
    await importVrmFromFile(selection, deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_vrm_file", {
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
