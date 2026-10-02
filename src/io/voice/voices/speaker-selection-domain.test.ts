import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
} from "./speaker-selection";

afterEach(() => vi.unstubAllGlobals());

describe("speaker selection domain preset", () => {
  it("synthesizes a speaker from defaultValue", () => {
    expect(createSpeakerSelection({ defaultValue: "natsume" }).list()).toEqual([
      { id: "natsume", label: "natsume", ref_url: "" },
    ]);
  });

  it("coerces valid imports, forces source user and reads a missing provider as irodori", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          { id: "a.b", ref_url: "/a.mp3", source: "bundled" },
          { id: "ナツメ", label: "Natsume", ref_url: "/n.mp3" },
          { id: "model9", ref_url: "/m.mp3", provider: "fish" },
        ]),
    });

    expect(localStorageUserSpeakerStorage().load()).toEqual([
      { id: "a.b", label: "a.b", ref_url: "/a.mp3", source: "user", provider: "irodori" },
      { id: "ナツメ", label: "Natsume", ref_url: "/n.mp3", source: "user", provider: "irodori" },
      { id: "model9", label: "model9", ref_url: "/m.mp3", source: "user", provider: "fish" },
    ]);
  });

  it("rejects unsafe ids and entries missing an id", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          { id: "..", ref_url: "/x.mp3" },
          { id: ".hidden", ref_url: "/x.mp3" },
          { id: "a/b", ref_url: "/x.mp3" },
          { id: "a\\b", ref_url: "/x.mp3" },
          { id: "", ref_url: "/x.mp3" },
          { ref_url: "/x.mp3" },
        ]),
    });

    expect(localStorageUserSpeakerStorage().load()).toEqual([]);
  });

  it("accepts a clip-less entry — a pasted library voice id has no local clip", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify([{ id: "lib-voice", label: "lib-voice", ref_url: "" }]),
    });

    expect(localStorageUserSpeakerStorage().load()).toEqual([
      { id: "lib-voice", label: "lib-voice", ref_url: "", source: "user", provider: "irodori" },
    ]);
  });

  it("selects a pasted library id that is absent from the manifest", () => {
    const selection = createSpeakerSelection({
      defaultValue: "natsume",
      available: [{ id: "natsume", label: "Natsume", ref_url: "" }],
    });

    selection.addUserOption({ id: "lib-voice", label: "lib-voice", ref_url: "", source: "user" });
    selection.select("lib-voice");

    expect(selection.getActiveId()).toBe("lib-voice");
  });

  it("keeps the default localStorage keys", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(), setItem, removeItem: vi.fn() });
    localStorageSpeakerStorage().save("natsume");
    localStorageUserSpeakerStorage().save([]);
    expect(setItem.mock.calls.map(([key]) => key)).toEqual(["yui.speaker", "yui.speaker.user"]);
  });
});
