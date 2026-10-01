// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStageBackground } from "../../../io/assets/stage/stage-background";
import { createStageBackdrop } from "./stage-backdrop";

const IMAGE = { id: "beach.jpg", path: "/data/stage/beach.jpg" };
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(decodeImage: (url: string) => Promise<void> = async () => {}) {
  const root = document.createElement("div");
  const store = createStageBackground();
  const backdrop = createStageBackdrop({
    root,
    store,
    resolveSrc: async (p) => `asset://localhost${p}`,
    decodeImage,
    log,
  });
  return { root, store, backdrop };
}

describe("createStageBackdrop", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("an image sets the class and the property once it decodes, and Default clears both", async () => {
    const { root, store } = setup();
    await flush();
    expect(root.classList.contains("has-stage-image")).toBe(false);
    expect(root.style.getPropertyValue("--yui-stage-image")).toBe("");
    store.setImage(IMAGE);
    await flush();
    expect(root.classList.contains("has-stage-image")).toBe(true);
    expect(root.style.getPropertyValue("--yui-stage-image")).toBe(
      'url("asset://localhost/data/stage/beach.jpg")',
    );
    store.setMode("default");
    expect(root.classList.contains("has-stage-image")).toBe(false);
    expect(root.style.getPropertyValue("--yui-stage-image")).toBe("");
  });

  it("a stored image applies at startup", async () => {
    const root = document.createElement("div");
    const store = createStageBackground({
      storage: { load: () => ({ mode: "image", image: IMAGE }), save: () => {} },
    });
    createStageBackdrop({
      root,
      store,
      resolveSrc: async (p) => p,
      decodeImage: async () => {},
      log,
    });
    await flush();
    expect(root.classList.contains("has-stage-image")).toBe(true);
  });

  it("escapes quotes and backslashes in the URL", async () => {
    const root = document.createElement("div");
    const store = createStageBackground();
    createStageBackdrop({
      root,
      store,
      resolveSrc: async () => 'http://x/a"b\\c.jpg',
      decodeImage: async () => {},
      log,
    });
    store.setImage(IMAGE);
    await flush();
    expect(root.style.getPropertyValue("--yui-stage-image")).toBe('url("http://x/a\\"b\\\\c.jpg")');
  });

  it("a decode failure clears the image, falls back to default and warns", async () => {
    const { root, store } = setup(async () => {
      throw new Error("missing");
    });
    store.setImage(IMAGE);
    await flush();
    expect(store.get()).toEqual({ mode: "default", image: null });
    expect(root.classList.contains("has-stage-image")).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });

  it("drops a decode that finished after a newer request (Image, Default, Image)", async () => {
    const pending: Array<() => void> = [];
    const { root, store } = setup(
      (url) =>
        new Promise<void>((resolve) => {
          pending.push(resolve);
          void url;
        }),
    );
    store.setImage(IMAGE);
    store.setMode("default");
    store.setMode("image");
    await flush();
    expect(pending).toHaveLength(2);
    // The first request resolves last: it must not apply, and the second applies once.
    pending[1]();
    await flush();
    expect(root.classList.contains("has-stage-image")).toBe(true);
    store.setMode("default");
    pending[0]();
    await flush();
    expect(root.classList.contains("has-stage-image")).toBe(false);
  });

  it("an older decode failing after a newer image applied leaves the store alone", async () => {
    const settle: Array<{ ok: () => void; fail: () => void }> = [];
    const { root, store } = setup(
      () =>
        new Promise<void>((resolve, reject) => {
          settle.push({ ok: resolve, fail: () => reject(new Error("late")) });
        }),
    );
    const next = { id: "dusk.webp", path: "/data/stage/dusk.webp" };
    store.setImage(IMAGE);
    store.setImage(next);
    await flush();
    settle[1].ok();
    await flush();
    settle[0].fail();
    await flush();
    expect(store.get()).toEqual({ mode: "image", image: next });
    expect(root.classList.contains("has-stage-image")).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("dispose stops reacting and clears the stage", async () => {
    const { root, store, backdrop } = setup();
    store.setImage(IMAGE);
    await flush();
    backdrop.dispose();
    expect(root.classList.contains("has-stage-image")).toBe(false);
    store.setMode("default");
    store.setMode("image");
    await flush();
    expect(root.classList.contains("has-stage-image")).toBe(false);
  });
});
