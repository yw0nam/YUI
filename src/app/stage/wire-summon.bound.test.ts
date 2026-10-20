import { afterEach, expect, it, vi } from "vitest";
import { createEventBus } from "../../dispatcher/core/event-bus";
import { createLogger } from "../../logger";
import { wireSummonHotkey } from "./wire-summon";

const { register, unregisterAll } = vi.hoisted(() => ({
  register: vi.fn(async () => {}),
  unregisterAll: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register,
  unregisterAll,
  unregister: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ show: async () => {}, setFocus: async () => {} })),
}));
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])("only main registers shortcuts (bound: %s)", async (bound) => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  const handle = wireSummonHotkey({
    bound,
    accelerator: "CmdOrCtrl+Shift+Y",
    surfaces: { summonInput: () => {} },
    bus: createEventBus(),
    peek: { active: () => false, exit: async () => {} },
    log: createLogger("test"),
  });
  if (!bound) await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  else await new Promise((r) => setTimeout(r, 20));
  expect(unregisterAll).toHaveBeenCalledTimes(bound ? 0 : 1);
  expect(register).toHaveBeenCalledTimes(bound ? 0 : 1);
  await handle.dispose();
});
