import { describe, expect, it, vi } from "vitest";
import type { PersistedStorage } from "../../../settings/persisted-store";
import { createStageBackground, type StageBackground } from "./stage-background";

const IMAGE = { id: "beach.jpg", path: "/data/app/stage/beach.jpg" };

function memory(initial: unknown = null): PersistedStorage<StageBackground> & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    load: () => initial as StageBackground | null,
    save: (s) => {
      saved.push(s);
    },
  };
}

describe("createStageBackground", () => {
  it("starts on the default stage and returns isolated copies", () => {
    const store = createStageBackground({ storage: memory() });
    expect(store.get()).toEqual({ mode: "default", image: null });
    store.setImage(IMAGE);
    const copy = store.get();
    copy.image!.id = "changed.png";
    expect(store.get().image?.id).toBe("beach.jpg");
  });

  it("setImage stores the image and selects it in one notification", () => {
    const storage = memory();
    const store = createStageBackground({ storage });
    const seen = vi.fn();
    store.subscribe(seen);
    store.setImage(IMAGE);
    expect(store.get()).toEqual({ mode: "image", image: IMAGE });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(storage.saved).toEqual([{ mode: "image", image: IMAGE }]);
  });

  it("setMode image without a stored image is a no-op", () => {
    const store = createStageBackground({ storage: memory() });
    const seen = vi.fn();
    store.subscribe(seen);
    store.setMode("image");
    expect(store.get().mode).toBe("default");
    expect(seen).not.toHaveBeenCalled();
  });

  it("setMode switches between default and image while the image stays stored", () => {
    const store = createStageBackground({ storage: memory() });
    store.setImage(IMAGE);
    store.setMode("default");
    expect(store.get()).toEqual({ mode: "default", image: IMAGE });
    store.setMode("image");
    expect(store.get().mode).toBe("image");
  });

  it("clearImage drops the image and returns to default", () => {
    const store = createStageBackground({ storage: memory() });
    store.setImage(IMAGE);
    store.clearImage();
    expect(store.get()).toEqual({ mode: "default", image: null });
  });

  it("restores a stored record", () => {
    const store = createStageBackground({ storage: memory({ mode: "image", image: IMAGE }) });
    expect(store.get()).toEqual({ mode: "image", image: IMAGE });
  });

  it.each([
    ["a non-object", "nope"],
    ["an array", []],
    ["an unknown mode", { mode: "video", image: null }],
    ["a malformed image", { mode: "image", image: { id: 3, path: "/x" } }],
    ["image mode without an image", { mode: "image", image: null }],
  ])("falls back to default for %s", (_name, raw) => {
    expect(createStageBackground({ storage: memory(raw) }).get()).toEqual({
      mode: "default",
      image: null,
    });
  });

  it.each([
    "../x.jpg",
    "a/b.jpg",
    "beach.gif",
    "beach.jpeg",
    "beach",
    ".jpg",
    "con.jpg",
  ])("drops a stored image whose id %s is not a safe file name", (id) => {
    const store = createStageBackground({
      storage: memory({ mode: "image", image: { id, path: "/data/stage/x.jpg" } }),
    });
    expect(store.get()).toEqual({ mode: "default", image: null });
  });

  it.each([
    "asset://localhost/x.jpg",
    "http://asset.localhost/x.jpg",
    "javascript:alert(1)",
    "file:///x.jpg",
    "",
  ])("drops a stored image whose path %s carries a scheme or is empty", (path) => {
    const store = createStageBackground({
      storage: memory({ mode: "image", image: { id: "beach.jpg", path } }),
    });
    expect(store.get()).toEqual({ mode: "default", image: null });
  });

  it("keeps a Windows drive path and a stem with dots", () => {
    const image = { id: "my.photo.v2.webp", path: "C:\\Users\\me\\AppData\\stage\\my.photo.v2.webp" };
    const store = createStageBackground({ storage: memory({ mode: "image", image }) });
    expect(store.get().image).toEqual(image);
  });
});
