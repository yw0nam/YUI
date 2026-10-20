// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { wirePresetSwitch } from "./wire-preset";

const LIST = [
  { id: "default", name: "default" },
  { id: "aaaa0001", name: "natsume" },
];

function writeFromOtherWindow(value: { active: string; list: typeof LIST }): void {
  const raw = JSON.stringify(value);
  localStorage.setItem("yui.presets", raw);
  window.dispatchEvent(new StorageEvent("storage", { key: "yui.presets", newValue: raw }));
}

describe("wirePresetSwitch", () => {
  let calls: string[];
  let dispose: () => void;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("yui.presets", JSON.stringify({ active: "default", list: LIST }));
    calls = [];
  });

  afterEach(() => {
    dispose();
  });

  function wire() {
    const registry = createPresetRegistry();
    dispose = wirePresetSwitch({
      registry,
      onBeforeReload: () => calls.push("stop"),
      reload: () => calls.push("reload"),
    });
    return registry;
  }

  it("stops the turn, then reloads, when this window activates another preset", () => {
    const registry = wire();

    registry.activate("aaaa0001");

    expect(calls).toEqual(["stop", "reload"]);
  });

  it("stops the turn, then reloads, when another window activates another preset", () => {
    wire();

    writeFromOtherWindow({ active: "aaaa0001", list: LIST });

    expect(calls).toEqual(["stop", "reload"]);
  });

  it("keeps running and picks up the list when another window edits presets without switching", () => {
    const registry = wire();

    writeFromOtherWindow({
      active: "default",
      list: [...LIST, { id: "bbbb0002", name: "perlica" }],
    });

    expect(calls).toEqual([]);
    expect(registry.get().list.map((e) => e.name)).toEqual(["default", "natsume", "perlica"]);
  });
});
