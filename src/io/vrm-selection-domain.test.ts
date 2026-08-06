import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "./vrm-selection";

afterEach(() => vi.unstubAllGlobals());

describe("VRM selection domain preset", () => {
  it.each([
    ["/vrms/carlotta.vrm", "carlotta", "Carlotta"],
    ["https://cdn.test/AvatarSample_B.VRM?rev=1#view", "AvatarSample_B", "AvatarSample_B"],
    ["/vrms/.vrm", "avatar", "Avatar"],
    ["/vrms/", "avatar", "Avatar"],
  ])("synthesizes %s with id %s and label %s", (defaultUrl, id, label) => {
    expect(createVrmSelection({ defaultUrl }).list()).toEqual([
      { id, label, url: defaultUrl, source: "bundled" },
    ]);
  });

  it("coerces valid imports and forces source user", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          { id: "a.b", url: "/a.vrm", source: "bundled" },
          { id: "初音", label: "Miku", url: "/miku.vrm" },
        ]),
    });

    expect(localStorageUserVrmStorage().load()).toEqual([
      { id: "a.b", label: "a.b", url: "/a.vrm", source: "user" },
      { id: "初音", label: "Miku", url: "/miku.vrm", source: "user" },
    ]);
  });

  it("rejects unsafe ids and entries missing id or url", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([
          { id: "..", url: "/x.vrm" },
          { id: ".hidden", url: "/x.vrm" },
          { id: "a/b", url: "/x.vrm" },
          { id: "a\\b", url: "/x.vrm" },
          { id: "", url: "/x.vrm" },
          { url: "/x.vrm" },
          { id: "safe" },
        ]),
    });

    expect(localStorageUserVrmStorage().load()).toEqual([]);
  });

  it("keeps the default localStorage keys", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(), setItem, removeItem: vi.fn() });
    localStorageVrmStorage().save("miko");
    localStorageUserVrmStorage().save([]);
    expect(setItem.mock.calls.map(([key]) => key)).toEqual(["yui.vrm", "yui.vrm.user"]);
  });
});
