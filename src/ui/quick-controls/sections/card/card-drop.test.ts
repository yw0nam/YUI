// @vitest-environment jsdom
/**
 * card-drop.test.ts — the drop cover of the settings window.
 *
 * Pins src/ui/quick-controls/sections/card/card-drop.ts: the drag and busy looks, the refusals
 * shown before anything is read, the one import a single card file starts, the refusal's 2.4 s,
 * and that nothing reaches the cover or the import after dispose.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDropEvent } from "../../../../io/window/file-drop/file-drop";
import type { Logger } from "../../../../logger";
import { setLocale } from "../../../i18n";
import { createCardDrop } from "./card-drop";
import type { CardIo } from "./card-io";

type Outcome = Awaited<ReturnType<CardIo["importDropped"]>>;

const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function setup(opts: { importing?: boolean; outcome?: () => Promise<Outcome> } = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  let emit!: (e: FileDropEvent) => void;
  let resolveSubscription!: () => void;
  const unlisten = vi.fn();
  const subscribe = vi.fn(async (handler: (e: FileDropEvent) => void) => {
    emit = handler;
    await new Promise<void>((resolve) => (resolveSubscription = resolve));
    return unlisten;
  });
  const importDropped = vi.fn<CardIo["importDropped"]>(opts.outcome ?? (async () => "imported"));
  const drop = createCardDrop({
    root,
    subscribe,
    isImporting: () => opts.importing ?? false,
    importDropped,
    log,
  });
  const cover = root.querySelector<HTMLElement>(".yui-card-drop")!;
  return {
    drop,
    cover,
    importDropped,
    unlisten,
    emit: (e: FileDropEvent) => emit(e),
    resolveSubscription: () => resolveSubscription(),
    shown: () => [cover.classList.contains("is-on"), cover.getAttribute("aria-hidden")],
  };
}

describe("createCardDrop", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("a file over the window shows the cover with the drop title", () => {
    const s = setup();
    s.emit({ type: "enter", paths: ["/a/Mio.yui"] });

    expect(s.shown()).toEqual([true, "false"]);
    expect(s.cover.querySelector(".yui-card-drop__title")?.textContent).toBe("Drop to import");
    s.emit({ type: "leave" });
    expect(s.shown()).toEqual([false, "true"]);
  });

  it("a file over the window while an import runs shows the busy look", () => {
    const s = setup({ importing: true });
    s.emit({ type: "enter", paths: ["/a/Mio.yui"] });

    expect(s.cover.classList.contains("is-busy")).toBe(true);
    expect(s.cover.querySelector(".yui-card-drop__title")?.textContent).toBe("Importing");
  });

  it.each([
    ["two files", ["/a/Mio.yui", "/a/Rin.png"], "Drop one file at a time"],
    [
      "a file of another kind",
      ["/a/notes.txt"],
      "That file can't be imported. Drop a preset file (.yui), or a JSON or PNG card",
    ],
  ])("a drop of %s shows its refusal and reads nothing", (_label, paths, message) => {
    const s = setup();
    s.emit({ type: "drop", paths });

    expect(s.cover.classList.contains("is-refused")).toBe(true);
    expect(s.cover.querySelector(".yui-card-drop__err")?.textContent).toBe(message);
    expect(s.importDropped).not.toHaveBeenCalled();
  });

  it("a drop of one card file imports it once", () => {
    const s = setup();
    s.emit({ type: "drop", paths: ["/a/Mio.YUI"] });

    expect(s.importDropped).toHaveBeenCalledTimes(1);
    expect(s.importDropped).toHaveBeenCalledWith();
  });

  it("a failed import shows its line in the cover for 2400 ms", async () => {
    vi.useFakeTimers();
    const s = setup({ outcome: async () => "failed" });
    s.emit({ type: "drop", paths: ["/a/Mio.yui"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.cover.querySelector(".yui-card-drop__err")?.textContent).toBe(
      "Could not import that card",
    );
    expect(s.shown()).toEqual([true, "false"]);

    vi.advanceTimersByTime(2399);
    expect(s.shown()).toEqual([true, "false"]);
    vi.advanceTimersByTime(1);
    expect(s.shown()).toEqual([false, "true"]);
  });

  it("a dispose before the subscription resolves still unlistens, and a later drop reads nothing", async () => {
    const s = setup();
    s.drop.dispose();
    s.emit({ type: "drop", paths: ["/a/Mio.yui"] });
    s.emit({ type: "enter", paths: ["/a/Mio.yui"] });
    s.resolveSubscription();

    await vi.waitFor(() => expect(s.unlisten).toHaveBeenCalledTimes(1));
    expect(s.importDropped).not.toHaveBeenCalled();
    expect(s.shown()).toEqual([false, "true"]);
  });

  it("an import that settles after dispose shows nothing and starts no timer", async () => {
    vi.useFakeTimers();
    let settle!: (o: Outcome) => void;
    const s = setup({ outcome: () => new Promise<Outcome>((resolve) => (settle = resolve)) });
    s.emit({ type: "drop", paths: ["/a/Mio.yui"] });
    s.drop.dispose();
    settle("failed");
    await Promise.resolve();
    await Promise.resolve();

    expect(s.cover.classList.contains("is-refused")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
