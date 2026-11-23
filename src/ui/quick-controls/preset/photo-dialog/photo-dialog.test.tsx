// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Logger } from "../../../../logger";
import type { PhotoCrop, PhotoSize } from "../../../../settings/preset/photo-crop";
import { PhotoDialog, type PhotoDialogProps } from "./photo-dialog";
import { closeDialogs, stubModalDialog } from "./test-helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIZE: PhotoSize = { width: 900, height: 1000 };
const entry = { id: "aaaa0001", name: "Natsume", thumbnail: "asset://a.png" };

beforeAll(stubModalDialog);

const deferred = <T,>() => {
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
let info: ReturnType<typeof vi.fn>;

beforeEach(() => {
  save = vi.fn<(url: string, crop: PhotoCrop) => void>();
  saveUrl = vi.fn<(url: string) => void>();
  warn = vi.fn();
  info = vi.fn();
});

afterEach(() => {
  act(() => closeDialogs());
  act(() => cleanup());
});

// The caller unmounts the dialog once it closes.
function Shown(p: Omit<PhotoDialogProps, "onClosed">) {
  const [shown, setShown] = useState(true);
  return shown ? <PhotoDialog {...p} onClosed={() => setShown(false)} /> : null;
}

function open(over: Partial<Omit<PhotoDialogProps, "onClosed">> = {}) {
  act(() => {
    render(
      <Shown
        entry={entry}
        url="asset://a.png"
        picked={false}
        pick={async () => null}
        save={save}
        saveUrl={saveUrl}
        log={{ warn, info } as unknown as Logger}
        measure={async () => SIZE}
        {...over}
      />,
      { container: document.body.appendChild(document.createElement("div")) },
    );
  });
}
const button = (name: string) =>
  document.querySelector<HTMLButtonElement>(`dialog[open] [data-act=${name}]`)!;
const click = (name: string) => act(() => button(name).click());
const ready = () => vi.waitFor(() => expect(button("use").disabled).toBe(false));

describe("PhotoDialog", () => {
  it("opens on the stored crop and Use photo saves it unchanged", async () => {
    open({ entry: { ...entry, crop: { x: 0.1, y: 0.2, size: 0.5 } } });
    await ready();

    click("use");

    expect(save).toHaveBeenCalledTimes(1);
    const [url, crop] = save.mock.calls[0]!;
    expect(url).toBe("asset://a.png");
    expect(crop.x).toBeCloseTo(0.1, 9);
    expect(crop.y).toBeCloseTo(0.2, 9);
    expect(crop.size).toBeCloseTo(0.5, 9);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("previews the face at the sizes the app draws it, each with its place", async () => {
    open();
    await ready();

    const rows = [...document.querySelectorAll<HTMLElement>(".yui-photo-dialog__preview")];

    expect(
      rows.map((r) => [
        r.querySelector<HTMLElement>(".yui-uc__avatar")!.style.getPropertyValue("--yui-uc-size"),
        r.querySelector("span:not(.yui-uc__avatar)")!.textContent,
      ]),
    ).toEqual([
      ["36px", "Card · 36 px"],
      ["28px", "Character header · 28 px"],
      ["22px", "Unified chat · 22 px"],
      ["20px", "Name plate · 20 px"],
    ]);
  });

  it("the zoom slider's fill follows the zoom", async () => {
    open({ entry: { ...entry, crop: { x: 0, y: 0, size: 1 } } });
    await ready();
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!;
    const fill = () => slider.style.getPropertyValue("--fill");

    expect(fill()).toBe("0");
    act(() => {
      fireEvent.change(slider, { target: { value: "700" } });
    });
    expect(fill()).toBe("1");
    click("face");
    expect(Number(fill())).toBeCloseTo((900 / 495 - 1) / 6, 6);
  });

  it("logs the saved crop and a picked photo's default framing", async () => {
    open({ picked: true });
    await vi.waitFor(() =>
      expect(info).toHaveBeenCalledWith("photo_default_framed", { preset: "aaaa0001" }),
    );
    await ready();

    click("use");

    expect(info).toHaveBeenCalledWith("photo_crop_saved", { preset: "aaaa0001" });
  });

  it("a picked photo saves its default framing once, and Cancel adds nothing", async () => {
    open({ picked: true });
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith("asset://a.png", { x: 0, y: 0, size: 1 }),
    );

    click("cancel");

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("Choose another stores the new URL at once, then its default framing", async () => {
    const size = deferred<PhotoSize>();
    const measure = vi.fn(async (url: string) => (url === "asset://b.png" ? size.promise : SIZE));
    open({ measure, pick: async () => "asset://b.png" });
    await ready();

    click("choose");
    await vi.waitFor(() => expect(saveUrl).toHaveBeenCalledWith("asset://b.png"));
    expect(save).not.toHaveBeenCalled();
    expect(button("choose").disabled).toBe(true);

    size.resolve({ width: 1000, height: 500 });
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith("asset://b.png", { x: 0.25, y: 0, size: 0.5 }),
    );
  });

  it("a photo chosen just before Cancel is stored, then its default framing once measured", async () => {
    const picked = deferred<string | null>();
    open({ pick: () => picked.promise });
    await ready();

    click("choose");
    click("cancel");
    picked.resolve("asset://b.png");

    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith("asset://b.png", { x: 0, y: 0, size: 1 }),
    );
    expect(saveUrl).toHaveBeenCalledWith("asset://b.png");
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

    click("choose");

    await vi.waitFor(() => expect(button("use").disabled).toBe(true));
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

    click("choose");

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
    expect(button("choose").disabled).toBe(true);
    click("cancel");
    first.resolve(SIZE);
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith("asset://a.png", { x: 0, y: 0, size: 1 }),
    );

    save.mockClear();
    const stale = deferred<PhotoSize>();
    open({ picked: true, url: "asset://c.png", measure: () => stale.promise });
    click("cancel");
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

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    document.removeEventListener("keydown", onDoc);
    expect(onDoc).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("any save for a preset supersedes an older pick's pending default", async () => {
    const first = deferred<PhotoSize>();
    open({ picked: true, url: "asset://a.png", measure: () => first.promise });
    click("cancel");
    open({ entry: { ...entry, crop: { x: 0.1, y: 0.2, size: 0.5 } } });
    await ready();
    click("use");
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

    act(() => at("pointerdown", 100));
    act(() => at("pointermove", 110));
    expect(parseFloat(img.style.left)).toBeCloseTo(left0 + 10, 6);
    act(() => stage.dispatchEvent(new Event("pointercancel", { bubbles: true })));
    act(() => at("pointermove", 150));

    expect(parseFloat(img.style.left)).toBeCloseTo(left0 + 10, 6);
  });
});
