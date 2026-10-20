// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { wirePresetSwitch } from "./wire-preset";

const LIST = [
  { id: "default", name: "default" },
  { id: "aaaa0001", name: "natsume" },
];

describe("wirePresetSwitch", () => {
  let calls: string[];
  let remote: (p: { active: string }) => void;
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
      bridge: {
        emitPresetChanged: (p) => calls.push(`emit ${p.active}`),
        onPresetChanged: (cb) => {
          remote = cb;
          return () => {};
        },
      },
      onBeforeReload: () => calls.push("stop"),
      reload: () => calls.push("reload"),
    });
    return registry;
  }

  // Another window commits the registry; only what it sends next decides how this one hears it.
  function writeFromOtherWindow(value: { active: string; list: typeof LIST }): string {
    const raw = JSON.stringify(value);
    localStorage.setItem("yui.presets", raw);
    return raw;
  }

  it("tells the other windows, stops the turn, then reloads, when this window activates another preset", () => {
    const registry = wire();

    registry.activate("aaaa0001");

    expect(calls).toEqual(["emit aaaa0001", "stop", "reload"]);
  });

  it("stops the turn, then reloads, when another window's switch arrives over the bridge", () => {
    const registry = wire();
    writeFromOtherWindow({ active: "aaaa0001", list: LIST });

    remote({ active: "aaaa0001" });

    expect(calls).toEqual(["stop", "reload"]);
    expect(registry.get().active).toBe("aaaa0001");
  });

  it("stops the turn, then reloads, when another window's switch arrives only as a storage event", () => {
    wire();
    const raw = writeFromOtherWindow({ active: "aaaa0001", list: LIST });

    window.dispatchEvent(new StorageEvent("storage", { key: "yui.presets", newValue: raw }));

    expect(calls).toEqual(["stop", "reload"]);
  });

  it("keeps running when the bridge names the preset this window booted with", () => {
    wire();

    remote({ active: "default" });

    expect(calls).toEqual([]);
  });

  it("keeps running and picks up the list when another window edits presets without switching", () => {
    const registry = wire();
    const raw = writeFromOtherWindow({
      active: "default",
      list: [...LIST, { id: "bbbb0002", name: "perlica" }],
    });

    window.dispatchEvent(new StorageEvent("storage", { key: "yui.presets", newValue: raw }));

    expect(calls).toEqual([]);
    expect(registry.get().list.map((e) => e.name)).toEqual(["default", "natsume", "perlica"]);
  });
});
