// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { wirePresetSwitch } from "./wire-preset";

const LIST = [
  { id: "default", name: "default" },
  { id: "aaaa0001", name: "natsume" },
];

describe("wirePresetSwitch", () => {
  let calls: string[];
  let remote: (p: { active: string }) => void;
  // Settles the emit the fake bridge last handed out, as the Tauri transport does once the IPC lands.
  let settleEmit: () => void;
  let dispose: () => void;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("yui.presets", JSON.stringify({ active: "default", list: LIST }));
    calls = [];
  });

  afterEach(() => {
    dispose();
    vi.useRealTimers();
  });

  function wire() {
    const registry = createPresetRegistry({ newId: () => "bbbb0002" });
    dispose = wirePresetSwitch({
      registry,
      bridge: {
        emitPresetChanged: (p) => {
          calls.push(`emit ${p.active}`);
          return new Promise<void>((resolve) => {
            settleEmit = resolve;
          });
        },
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
  function writeFromOtherWindow(value: { active: string; list: { id: string; name: string }[] }) {
    const raw = JSON.stringify(value);
    localStorage.setItem("yui.presets", raw);
    return raw;
  }

  it("tells the other windows and stops the turn, then reloads once the message is sent", async () => {
    const registry = wire();

    registry.activate("aaaa0001");
    expect(calls).toEqual(["emit aaaa0001", "stop"]);

    settleEmit();
    await vi.waitFor(() => expect(calls).toEqual(["emit aaaa0001", "stop", "reload"]));
  });

  it("reloads after 250 ms when the message never settles", () => {
    vi.useFakeTimers();
    const registry = wire();

    registry.activate("aaaa0001");
    vi.advanceTimersByTime(249);
    expect(calls).toEqual(["emit aaaa0001", "stop"]);

    vi.advanceTimersByTime(1);
    return vi.waitFor(() => expect(calls).toEqual(["emit aaaa0001", "stop", "reload"]));
  });

  it("tells the other windows about a list edit and keeps running", () => {
    const registry = wire();

    registry.create("perlica");

    expect(calls).toEqual(["emit default"]);
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

  it("keeps running and picks up the list when another window edits presets without switching", () => {
    const registry = wire();
    writeFromOtherWindow({
      active: "default",
      list: [...LIST, { id: "bbbb0002", name: "perlica" }],
    });

    remote({ active: "default" });

    expect(calls).toEqual([]);
    expect(registry.get().list.map((e) => e.name)).toEqual(["default", "natsume", "perlica"]);
  });

  it("follows a switch another window made while this one was booting", () => {
    const registry = createPresetRegistry();
    writeFromOtherWindow({ active: "aaaa0001", list: LIST });

    dispose = wirePresetSwitch({
      registry,
      bridge: { emitPresetChanged: async () => {}, onPresetChanged: () => () => {} },
      onBeforeReload: () => calls.push("stop"),
      reload: () => calls.push("reload"),
    });

    expect(calls).toEqual(["stop", "reload"]);
  });
});
