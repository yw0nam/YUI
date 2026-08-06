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

  it("coerces valid imports and forces source user", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          { id: "a.b", ref_url: "/a.mp3", source: "bundled" },
          { id: "ナツメ", label: "Natsume", ref_url: "/n.mp3" },
        ]),
    });

    expect(localStorageUserSpeakerStorage().load()).toEqual([
      { id: "a.b", label: "a.b", ref_url: "/a.mp3", source: "user" },
      { id: "ナツメ", label: "Natsume", ref_url: "/n.mp3", source: "user" },
    ]);
  });

  it("rejects unsafe ids and entries missing id or ref_url", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          { id: "..", ref_url: "/x.mp3" },
          { id: ".hidden", ref_url: "/x.mp3" },
          { id: "a/b", ref_url: "/x.mp3" },
          { id: "a\\b", ref_url: "/x.mp3" },
          { id: "", ref_url: "/x.mp3" },
          { ref_url: "/x.mp3" },
          { id: "safe" },
        ]),
    });

    expect(localStorageUserSpeakerStorage().load()).toEqual([]);
  });

  it("keeps the default localStorage keys", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(), setItem, removeItem: vi.fn() });
    localStorageSpeakerStorage().save("natsume");
    localStorageUserSpeakerStorage().save([]);
    expect(setItem.mock.calls.map(([key]) => key)).toEqual(["yui.speaker", "yui.speaker.user"]);
  });
});
