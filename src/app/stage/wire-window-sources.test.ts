import { describe, expect, it } from "vitest";
import { wireSummonHotkey } from "./wire-summon";
import { wireWindowSources } from "./wire-window-sources";

describe("configured platform wiring", () => {
  it("returns stable no-op handles outside Tauri", async () => {
    const windowSources = wireWindowSources({} as never);
    const summonHotkey = wireSummonHotkey({ accelerator: "CmdOrCtrl+Shift+Y" } as never);

    expect(() => {
      windowSources.noteUserDrag();
      windowSources.noteUserDragEnd();
      windowSources.dispose();
    }).not.toThrow();
    await expect(summonHotkey.apply("CmdOrCtrl+Shift+U")).resolves.toBeUndefined();
    await expect(summonHotkey.dispose()).resolves.toBeUndefined();
  });
});
