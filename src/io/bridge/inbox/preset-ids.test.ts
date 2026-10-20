import { expect, it, vi } from "vitest";
import { syncPresetIds } from "./preset-ids";

it("syncs ids and reports failures without throwing", async () => {
  const invoke = vi.fn(async () => undefined);
  expect(await syncPresetIds(["default"], { invoke })).toBe(null);
  expect(invoke).toHaveBeenCalledWith("sync_preset_ids", { ids: ["default"] });
  expect(await syncPresetIds([], { invoke: vi.fn().mockRejectedValue(new Error("refused")) })).toBe(
    "Error: refused",
  );
});
it("does nothing off Tauri", async () => {
  expect(await syncPresetIds(["default"])).toBe(null);
});
