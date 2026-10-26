// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Logger } from "../../../../logger";
import type { PhotoCrop, PhotoSize } from "../../../../settings/preset/photo-crop";
import { openPhotoDialog } from "./photo-dialog";
import { closeDialogs, stubModalDialog } from "./test-helpers";

const SIZE: PhotoSize = { width: 900, height: 1000 };
const entry = { id: "aaaa0001", name: "Natsume", thumbnail: "asset://a.png" };

beforeAll(stubModalDialog);

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

let save: Mock<(url: string, crop: PhotoCrop) => void>;
let saveUrl: Mock<(url: string) => void>;
let warn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  save = vi.fn<(url: string, crop: PhotoCrop) => void>();
  saveUrl = vi.fn<(url: string) => void>();
  warn = vi.fn();
});

afterEach(() => {
  closeDialogs();
});

function open(over: Partial<Parameters<typeof openPhotoDialog>[0]> = {}) {
  openPhotoDialog({
    entry,
    url: "asset://a.png",
    picked: false,
    pick: async () => null,
    save,
    saveUrl,
    log: { warn } as unknown as Logger,
    measure: async () => SIZE,
    ...over,
  });
}
const act = (name: string) => document.querySelector<HTMLButtonElement>(`[data-act=${name}]`)!;
const ready = () => vi.waitFor(() => expect(act("use").disabled).toBe(false));

describe("openPhotoDialog", () => {
  it("opens on the stored crop and Use photo saves it unchanged", async () => {
    open({ entry: { ...entry, crop: { x: 0.1, y: 0.2, size: 0.5 } } });
    await ready();

    act("use").click();

    expect(save).toHaveBeenCalledTimes(1);
    const [url, crop] = save.mock.calls[0]!;
    expect(url).toBe("asset://a.png");
    expect(crop.x).toBeCloseTo(0.1, 9);
    expect(crop.y).toBeCloseTo(0.2, 9);
    expect(crop.size).toBeCloseTo(0.5, 9);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("a picked photo saves its default framing once, and Cancel adds nothing", async () => {
    open({ picked: true });
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith("asset://a.png", { x: 0, y: 0, size: 1 }),
    );

    act("cancel").click();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("Choose another stores the new URL at once, then its default framing", async () => {
    const size = deferred<PhotoSize>();
    const measure = vi.fn(async (url: string) => (url === "asset://b.png" ? size.promise : SIZE));
    open({ measure, pick: async () => "asset://b.png" });
    await ready();

    act("choose").click();
    await vi.waitFor(() => expect(saveUrl).toHaveBeenCalledWith("asset://b.png"));
    expect(save).not.toHaveBeenCalled();
    expect(act("choose").disabled).toBe(true);

    size.resolve({ width: 1000, height: 500 });
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith("asset://b.png", { x: 0.25, y: 0, size: 0.5 }),
    );
  });

  it("a photo that cannot be measured shows the failure and saves no crop", async () => {
    open({
      measure: async (url) => {
        if (url === "asset://b.png") throw new Error("decode");
        return SIZE;
      },
      pick: async () => "asset://b.png",
    });
    await ready();

    act("choose").click();

    await vi.waitFor(() => expect(act("use").disabled).toBe(true));
    expect(saveUrl).toHaveBeenCalledWith("asset://b.png");
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLImageElement>(".yui-photo-dialog__stage > img")?.hidden).toBe(
      true,
    );
    expect(document.querySelectorAll(".yui-photo-dialog__preview")).toHaveLength(0);
    expect(document.querySelector(".yui-photo-dialog__error")?.textContent).toBe(
      "Could not use that photo. Choose a PNG or JPEG.",
    );
  });

  it("a rejected pick shows the failure and logs it", async () => {
    open({
      pick: async () => {
        throw new Error("refused");
      },
    });
    await ready();

    act("choose").click();

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith("photo_pick_failed", {
        preset: "aaaa0001",
        error: "Error: refused",
      }),
    );
    expect(saveUrl).not.toHaveBeenCalled();
  });

  it("a measure resolving after Cancel still saves the default, unless a later pick of that preset came first", async () => {
    const first = deferred<PhotoSize>();
    open({ picked: true, url: "asset://a.png", measure: () => first.promise });
    expect(act("choose").disabled).toBe(true);
    act("cancel").click();
    first.resolve(SIZE);
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith("asset://a.png", { x: 0, y: 0, size: 1 }),
    );

    save.mockClear();
    const stale = deferred<PhotoSize>();
    open({ picked: true, url: "asset://c.png", measure: () => stale.promise });
    act("cancel").click();
    open({ picked: true, url: "asset://d.png" });
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith("asset://d.png", { x: 0, y: 0, size: 1 }),
    );
    stale.resolve(SIZE);
    await new Promise((r) => setTimeout(r));

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the dialog and no document listener sees it, wherever focus is", async () => {
    open();
    await ready();
    const onDoc = vi.fn();
    document.addEventListener("keydown", onDoc);

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

    document.removeEventListener("keydown", onDoc);
    expect(onDoc).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("any save for a preset supersedes an older pick's pending default", async () => {
    const first = deferred<PhotoSize>();
    open({ picked: true, url: "asset://a.png", measure: () => first.promise });
    act("cancel").click();
    open({ entry: { ...entry, crop: { x: 0.1, y: 0.2, size: 0.5 } } });
    await ready();
    act("use").click();
    save.mockClear();

    first.resolve(SIZE);
    await new Promise((r) => setTimeout(r));

    expect(save).not.toHaveBeenCalled();
  });

  it("a drag ends on pointercancel", async () => {
    Element.prototype.setPointerCapture = () => {};
    open({ entry: { ...entry, crop: { x: 0.1, y: 0.2, size: 0.5 } } });
    await ready();
    const stage = document.querySelector<HTMLElement>(".yui-photo-dialog__stage")!;
    const img = stage.querySelector("img")!;
    const at = (type: string, x: number) =>
      stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 100, bubbles: true }));
    const left0 = parseFloat(img.style.left);

    at("pointerdown", 100);
    at("pointermove", 110);
    expect(parseFloat(img.style.left)).toBeCloseTo(left0 + 10, 6);
    stage.dispatchEvent(new Event("pointercancel"));
    at("pointermove", 150);

    expect(parseFloat(img.style.left)).toBeCloseTo(left0 + 10, 6);
  });
});
