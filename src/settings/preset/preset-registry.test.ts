import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPresetRegistry } from "./preset-registry";

let map: Map<string, string>;

beforeEach(() => {
  map = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seedPresets(active: string, list: Array<{ id: string; name: string }>): void {
  map.set("yui.presets", JSON.stringify({ active, list }));
}

describe("createPresetRegistry", () => {
  it("starts an installation without presets on the default preset", () => {
    const registry = createPresetRegistry();

    expect(registry.get()).toEqual({
      active: "default",
      list: [{ id: "default", name: "default" }],
    });
  });

  it.each([
    ["default", "yui."],
    ["aaaa0001", "yui.aaaa0001."],
  ])("create copies the settings of the active preset %s and none of its conversation", (active, prefix) => {
    seedPresets(active, [
      { id: "default", name: "default" },
      { id: "aaaa0001", name: "natsume" },
    ]);
    for (const rest of [
      "endpoints",
      "chat-key",
      "agent",
      "tts",
      "tts-key",
      "speaker",
      "vrm",
      "filler",
      "message-window",
      "chat-id",
      "chat_transcript",
      "previous_response_id",
      "context-history",
      "session_diagnostics",
      "previous-turn",
    ]) {
      map.set(`${prefix}${rest}`, `${rest}-value`);
    }
    map.set("yui.vrm.user", "[]");
    const registry = createPresetRegistry({ newId: () => "bbbb0002" });

    expect(registry.create("perlica")).toBe("bbbb0002");

    const copied = [...map.keys()].filter((k) => k.startsWith("yui.bbbb0002.")).sort();
    expect(copied).toEqual([
      "yui.bbbb0002.agent",
      "yui.bbbb0002.chat-key",
      "yui.bbbb0002.endpoints",
      "yui.bbbb0002.filler",
      "yui.bbbb0002.speaker",
      "yui.bbbb0002.tts",
      "yui.bbbb0002.tts-key",
      "yui.bbbb0002.vrm",
    ]);
    expect(map.get("yui.bbbb0002.endpoints")).toBe("endpoints-value");
    expect(registry.get()).toEqual({
      active,
      list: [
        { id: "default", name: "default" },
        { id: "aaaa0001", name: "natsume" },
        { id: "bbbb0002", name: "perlica" },
      ],
    });
  });

  it.each(["default", "natsume", "   "])("create refuses the name %j", (name) => {
    seedPresets("default", [
      { id: "default", name: "default" },
      { id: "aaaa0001", name: "natsume" },
    ]);
    const registry = createPresetRegistry({ newId: () => "bbbb0002" });

    expect(registry.create(name)).toBeNull();
    expect(registry.get().list).toHaveLength(2);
  });

  it("rename changes a preset's name, the default one included, and refuses a taken name", () => {
    seedPresets("default", [
      { id: "default", name: "default" },
      { id: "aaaa0001", name: "natsume" },
    ]);
    const registry = createPresetRegistry();

    expect(registry.rename("default", "home")).toBe(true);
    expect(registry.rename("aaaa0001", "home")).toBe(false);

    expect(registry.get().list).toEqual([
      { id: "default", name: "home" },
      { id: "aaaa0001", name: "natsume" },
    ]);
  });

  it("remove deletes only that preset's keys and leaves shared keys and other presets", () => {
    seedPresets("default", [
      { id: "default", name: "default" },
      { id: "aaaa0001", name: "natsume" },
      { id: "bbbb0002", name: "perlica" },
    ]);
    map.set("yui.aaaa0001.message-window", '{"mode":"popped"}');
    map.set("yui.aaaa0001.endpoints", "{}");
    map.set("yui.aaaa0001.chat_transcript", "[]");
    map.set("yui.aaaa0001.previous_response_id", "resp_1");
    map.set("yui.aaaa0001.previous_response_id.tool_outputs", "[]");
    map.set("yui.bbbb0002.endpoints", "{}");
    map.set("yui.endpoints", "{}");
    map.set("yui.vrm.user", "[]");
    const registry = createPresetRegistry();

    expect(registry.remove("aaaa0001")).toBe(true);

    expect([...map.keys()].filter((k) => k !== "yui.presets").sort()).toEqual([
      "yui.bbbb0002.endpoints",
      "yui.endpoints",
      "yui.vrm.user",
    ]);
    expect(registry.get().list).toEqual([
      { id: "default", name: "default" },
      { id: "bbbb0002", name: "perlica" },
    ]);
  });

  it.each([
    ["the default preset", "default"],
    ["the active preset", "aaaa0001"],
  ])("remove refuses %s", (_label, id) => {
    seedPresets("aaaa0001", [
      { id: "default", name: "default" },
      { id: "aaaa0001", name: "natsume" },
    ]);
    const registry = createPresetRegistry();

    expect(registry.remove(id)).toBe(false);
    expect(registry.get().list).toHaveLength(2);
  });

  it("activate stores the active id under yui.presets and ignores an unknown id", () => {
    seedPresets("default", [
      { id: "default", name: "default" },
      { id: "aaaa0001", name: "natsume" },
    ]);
    const registry = createPresetRegistry();

    registry.activate("cccc0003");
    registry.activate("aaaa0001");

    expect(JSON.parse(map.get("yui.presets")!).active).toBe("aaaa0001");
  });

  it("keeps a preset another window created when this window edits from an older list", () => {
    seedPresets("default", [
      { id: "default", name: "default" },
      { id: "aaaa0001", name: "natsume" },
    ]);
    const settingsWindow = createPresetRegistry({ newId: () => "bbbb0002" });
    const petWindow = createPresetRegistry();

    settingsWindow.create("perlica");
    petWindow.rename("aaaa0001", "natsu");

    expect(JSON.parse(map.get("yui.presets")!).list).toEqual([
      { id: "default", name: "default" },
      { id: "aaaa0001", name: "natsu" },
      { id: "bbbb0002", name: "perlica" },
    ]);
  });
});

it.each([
  "open",
  "pet",
  "settings",
  "message",
])("refuses removing or activating a %s preset", (mode) => {
  seedPresets("default", [{ id: "aaaa0001", name: "natsume" }]);
  map.set("yui.aaaa0001.endpoints", "{}");
  if (mode === "open") map.set("yui.windows", JSON.stringify({ open: ["aaaa0001"] }));
  else map.set(`yui.live-window.${mode}-aaaa0001`, "1");
  const registry = createPresetRegistry();
  expect(registry.remove("aaaa0001")).toBe(false);
  expect(registry.activate("aaaa0001")).toBe(false);
  expect(map.get("yui.aaaa0001.endpoints")).toBe("{}");
  expect(registry.get().active).toBe("default");
});
