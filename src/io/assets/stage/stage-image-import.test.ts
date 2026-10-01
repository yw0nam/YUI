import { describe, expect, it, vi } from "vitest";
import { createStageBackground } from "./stage-background";
import { importStageImage, type StageImportDeps } from "./stage-image-import";

const OLD = { id: "old.png", path: "/data/stage/old.png" };

function setup(over: Partial<StageImportDeps> = {}, initial = true) {
  const store = createStageBackground();
  if (initial) store.setImage(OLD);
  const invoke = vi.fn(async (cmd: string) =>
    cmd === "import_stage_image" ? { id: "new.jpg", destPath: "/data/stage/new.jpg" } : undefined,
  );
  const deps: StageImportDeps = {
    openDialog: vi.fn(async () => "content://picked/1"),
    invoke: invoke as unknown as StageImportDeps["invoke"],
    resolveSrc: vi.fn(async (p: string) => `asset://localhost/${p}`),
    decodeImage: vi.fn(async () => {}),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  };
  return { store, deps, invoke };
}

describe("importStageImage", () => {
  it("opens the picker with the image extensions", async () => {
    const { store, deps } = setup();
    await importStageImage(store, deps);
    expect(deps.openDialog).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
  });

  it("a cancelled pick changes nothing", async () => {
    const { store, deps, invoke } = setup({ openDialog: vi.fn(async () => null) });
    await importStageImage(store, deps);
    expect(invoke).not.toHaveBeenCalled();
    expect(store.get().image).toEqual(OLD);
  });

  it("stores the new image, selects it and removes the previous file", async () => {
    const { store, deps, invoke } = setup();
    await importStageImage(store, deps);
    expect(invoke).toHaveBeenCalledWith("import_stage_image", { srcPath: "content://picked/1" });
    expect(deps.decodeImage).toHaveBeenCalledWith("asset://localhost//data/stage/new.jpg");
    expect(store.get()).toEqual({
      mode: "image",
      image: { id: "new.jpg", path: "/data/stage/new.jpg" },
    });
    expect(invoke).toHaveBeenCalledWith("remove_stage_image", { id: "old.png" });
    expect(invoke).not.toHaveBeenCalledWith("remove_stage_image", { id: "new.jpg" });
  });

  it("the first image has no previous file to remove", async () => {
    const { store, deps, invoke } = setup({}, false);
    await importStageImage(store, deps);
    expect(store.get().image?.id).toBe("new.jpg");
    expect(invoke).not.toHaveBeenCalledWith("remove_stage_image", expect.anything());
  });

  it("a decode failure removes the new file, keeps the old state and throws", async () => {
    const { store, deps, invoke } = setup({
      decodeImage: vi.fn(async () => {
        throw new Error("bad image");
      }),
    });
    await expect(importStageImage(store, deps)).rejects.toThrow("bad image");
    expect(invoke).toHaveBeenCalledWith("remove_stage_image", { id: "new.jpg" });
    expect(invoke).not.toHaveBeenCalledWith("remove_stage_image", { id: "old.png" });
    expect(store.get()).toEqual({ mode: "image", image: OLD });
  });

  it("an unusable asset URL counts as a decode failure", async () => {
    const { store, deps, invoke } = setup({ resolveSrc: vi.fn(async () => "") });
    await expect(importStageImage(store, deps)).rejects.toThrow();
    expect(invoke).toHaveBeenCalledWith("remove_stage_image", { id: "new.jpg" });
    expect(store.get().image).toEqual(OLD);
  });

  it("a native rejection propagates and leaves the state untouched", async () => {
    const { store, deps } = setup({
      invoke: vi.fn(async () => {
        throw "unrecognized file type";
      }) as unknown as StageImportDeps["invoke"],
    });
    await expect(importStageImage(store, deps)).rejects.toBe("unrecognized file type");
    expect(store.get()).toEqual({ mode: "image", image: OLD });
  });

  it("a failing removal of the previous file is logged and the import still succeeds", async () => {
    const { store, deps } = setup();
    (deps.invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === "remove_stage_image") throw new Error("busy");
      return { id: "new.jpg", destPath: "/data/stage/new.jpg" };
    });
    await importStageImage(store, deps);
    expect(store.get().image?.id).toBe("new.jpg");
    expect(deps.log.warn).toHaveBeenCalled();
  });
});
