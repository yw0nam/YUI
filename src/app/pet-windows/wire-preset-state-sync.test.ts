// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { wirePresetStateSync } from "./wire-preset-state-sync";

it("syncs at boot, on local and remote changes, logs failure and disposes", async () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  const sync = vi.fn(async (_ids: string[]) => "refused");
  const log = { warn: vi.fn() };
  const off = wirePresetStateSync({ registry, sync, log });
  expect(sync).toHaveBeenLastCalledWith(["default"]);
  registry.create("other");
  expect(sync).toHaveBeenLastCalledWith(["default", "abcd1234"]);
  localStorage.setItem(
    "yui.presets",
    JSON.stringify({ active: "default", list: [{ id: "remote", name: "remote" }] }),
  );
  registry.reloadFromStorage();
  expect(sync).toHaveBeenLastCalledWith(["default", "remote"]);
  await Promise.resolve();
  expect(log.warn).toHaveBeenCalledWith("preset_ids_sync_failed", { error: "refused" });
  off();
  const count = sync.mock.calls.length;
  registry.rename("remote", "renamed");
  expect(sync).toHaveBeenCalledTimes(count);
  registry.dispose();
});
