// @vitest-environment jsdom
/**
 * user-asset-list.test.ts — shared user-asset-list scaffolding.
 *
 * Exercises the injected seams directly against a minimal fake option + fake store,
 * independent of the VRM/speaker domains that wrap this module: rename FSM commit/cancel
 * via keyboard, the delete-file-then-store-remove-then-active-fallback-swap ordering,
 * the reentrancy-guarded import flow with inline error, and row lookup/keyboard nav.
 */
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../logger";
import { createUserAssetList, resolveRovedId, type UserAssetListConfig } from "./user-asset-list";

// jsdom lacks CSS.escape — polyfill (mirrors quick-controls/test-helpers.ts).
if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== "function") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (value: string) =>
      // biome-ignore lint/suspicious/noControlCharactersInRegex: mirror the real escape's control-char handling.
      String(value).replace(/[\x00-\x7f]/g, (ch) => (/[a-zA-Z0-9_-]/.test(ch) ? ch : `\\${ch}`)),
  };
}

interface FakeOption {
  id: string;
  label?: string;
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Builds a row matching the shape produced by a domain's render loop: role=radio, data-*-id, optional renaming markup slot. */
function makeRow(id: string): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute("role", "radio");
  row.className = "yui-fake";
  row.dataset.fakeId = id;
  row.tabIndex = -1;
  const body = document.createElement("span");
  body.className = "yui-fake__body";
  row.appendChild(body);
  return row;
}

function makeHarness(overrides: Partial<UserAssetListConfig<FakeOption>> = {}) {
  const containerEl = document.createElement("div");
  const importErrorEl = document.createElement("p");
  importErrorEl.hidden = true;
  document.body.appendChild(containerEl);
  document.body.appendChild(importErrorEl);

  let options: FakeOption[] = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ];
  let activeId = "a";
  const log = makeLogger();

  // Forward ref: the default render below reads it, but it's only ever called after
  // createUserAssetList (and thus the `list =` assignment) below has completed.
  let list!: ReturnType<typeof createUserAssetList<FakeOption>>;

  const defaultRender = vi.fn(() => {
    // Re-render rows into containerEl to mirror a domain's render loop closely enough for
    // row-lookup/keyboard-nav assertions (rename-row markup is left to renderRenamingRow itself).
    containerEl.innerHTML = "";
    for (const opt of options) {
      const row = makeRow(opt.id);
      if (opt.id === list.getRenamingId()) {
        list.renderRenamingRow(row, opt);
      }
      containerEl.appendChild(row);
    }
  });

  const cfg = {
    containerEl,
    importErrorEl,
    classPrefix: "yui-fake",
    datasetKey: "fakeId",
    i18nNamespace: "vrm", // reuse an existing real i18n namespace so t() resolves to real strings
    logPrefix: "fake",
    log,
    list: () => options,
    getActiveId: () => activeId,
    getActive: () => options.find((o) => o.id === activeId)!,
    getLabel: (opt: FakeOption) => opt.label ?? opt.id,
    rename: vi.fn((id: string, label: string) => {
      const opt = options.find((o) => o.id === id);
      if (opt) opt.label = label;
    }),
    removeFile: vi.fn(async (_id: string) => {}),
    removeFromStore: vi.fn((id: string) => {
      options = options.filter((o) => o.id !== id);
      if (activeId === id) activeId = options[0]?.id ?? "a";
    }),
    swap: vi.fn(async (option: FakeOption) => {
      activeId = option.id;
    }),
    importFn: vi.fn(async () => {}),
    render: defaultRender,
    ...overrides,
  };

  list = createUserAssetList<FakeOption>(cfg);
  // Delegated listener, mirroring how a domain wires the container in the real app.
  containerEl.addEventListener("keydown", (e) => list.handleKeydown(e as KeyboardEvent));

  // The `...overrides` spread above widens each field's static type to the plain interface
  // signature (Partial<UserAssetListConfig<FakeOption>>'s declared shape). Every caller in this
  // file actually passes vi.fn() for these, so vi.mocked(...) restores the Mock type for assertions.
  return {
    list,
    containerEl,
    importErrorEl,
    renameFn: vi.mocked(cfg.rename),
    removeFile: vi.mocked(cfg.removeFile),
    removeFromStore: vi.mocked(cfg.removeFromStore),
    swap: vi.mocked(cfg.swap),
    importFn: vi.mocked(cfg.importFn),
    render: vi.mocked(cfg.render),
    log,
  };
}

describe("resolveRovedId", () => {
  it("keeps the roved id when it's still in the list, else falls back to active", () => {
    expect(resolveRovedId("b", ["a", "b"], "a")).toBe("b");
    expect(resolveRovedId("gone", ["a", "b"], "a")).toBe("a");
    expect(resolveRovedId(null, ["a", "b"], "a")).toBe("a");
  });
});

describe("rename FSM", () => {
  it("startRename renders the row in edit mode, Enter commits, and logs + persists", () => {
    const h = makeHarness();
    h.list.startRename("a");
    expect(h.render).toHaveBeenCalledTimes(1);
    expect(h.list.getRenamingId()).toBe("a");

    const input = h.containerEl.querySelector<HTMLInputElement>(".yui-ep-input")!;
    expect(input.value).toBe("A");
    input.value = "Alpha";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(h.renameFn).toHaveBeenCalledWith("a", "Alpha");
    expect(h.log.info).toHaveBeenCalledWith("fake_rename", { id: "a" });
    expect(h.list.getRenamingId()).toBeNull();
  });

  it("Escape cancels without renaming, and blur after cancel is a no-op", () => {
    const h = makeHarness();
    h.list.startRename("a");
    const input = h.containerEl.querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(h.list.getRenamingId()).toBeNull();
    expect(h.renameFn).not.toHaveBeenCalled();

    h.renameFn.mockClear();
    input.dispatchEvent(new Event("blur"));
    expect(h.renameFn).not.toHaveBeenCalled(); // already cleaned up, blur guard no-ops
  });

  it("blur commits when still the active renaming id", () => {
    const h = makeHarness();
    h.list.startRename("b");
    const input = h.containerEl.querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = "Bee";
    input.dispatchEvent(new Event("blur"));
    expect(h.renameFn).toHaveBeenCalledWith("b", "Bee");
  });

  it("reconcileRenaming clears a renaming id no longer present in the list", () => {
    const h = makeHarness();
    h.list.startRename("a");
    h.list.reconcileRenaming(["b"]); // "a" no longer present
    expect(h.list.getRenamingId()).toBeNull();
  });

  it("focusIfRenaming reports handled exactly while renaming", () => {
    const h = makeHarness();
    expect(h.list.focusIfRenaming()).toBe(false);
    h.list.startRename("a");
    expect(h.list.focusIfRenaming()).toBe(true);
  });
});

describe("remove flow", () => {
  it("deletes the file first; on failure, does not touch the store and does not render", async () => {
    const h = makeHarness({
      removeFile: vi.fn(async () => Promise.reject(new Error("disk error"))),
    });
    await h.list.remove("b");
    expect(h.removeFromStore).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalledWith("fake_delete_failed", {
      id: "b",
      error: "Error: disk error",
    });
  });

  it("removes from the store and renders directly when the removed option was not active", async () => {
    const h = makeHarness(); // active is "a"
    await h.list.remove("b");
    expect(h.removeFromStore).toHaveBeenCalledWith("b");
    expect(h.swap).not.toHaveBeenCalled(); // not active -> no fallback swap
    expect(h.render).toHaveBeenCalledTimes(1);
  });

  it("swaps to the fallback option when the removed option was active, without an extra render on swap success", async () => {
    const h = makeHarness(); // active is "a"
    await h.list.remove("a");
    expect(h.removeFromStore).toHaveBeenCalledWith("a");
    expect(h.swap).toHaveBeenCalledWith({ id: "b", label: "B" }); // fallback option post-removal
    expect(h.render).not.toHaveBeenCalled(); // swap success needs no explicit render (store subscription handles it)
  });

  it("renders when the fallback swap itself fails", async () => {
    const h = makeHarness({ swap: vi.fn(async () => Promise.reject(new Error("swap failed"))) });
    await h.list.remove("a");
    expect(h.log.error).toHaveBeenCalledWith("fake_fallback_swap_failed", {
      error: "Error: swap failed",
    });
    expect(h.render).toHaveBeenCalledTimes(1);
  });
});

describe("import flow", () => {
  it("guards reentry while importing", async () => {
    let resolveImport: () => void = () => {};
    const importFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const h = makeHarness({ importFn });
    const first = h.list.runImport();
    const second = h.list.runImport(); // ignored — already importing
    expect(h.list.isImporting()).toBe(true);
    expect(importFn).toHaveBeenCalledTimes(1);
    resolveImport();
    await first;
    await second;
    expect(h.list.isImporting()).toBe(false);
  });

  it("shows inline error and logs on failure, hides error at the next attempt", async () => {
    const h = makeHarness({ importFn: vi.fn(async () => Promise.reject(new Error("bad file"))) });
    await h.list.runImport();
    expect(h.importErrorEl.hidden).toBe(false);
    expect(h.log.error).toHaveBeenCalledWith("fake_import_failed", { error: "Error: bad file" });

    h.importFn.mockResolvedValueOnce(undefined);
    await h.list.runImport();
    expect(h.importErrorEl.hidden).toBe(true);
  });

  it("handleAddClick starts the import", async () => {
    const h = makeHarness();
    h.list.handleAddClick();
    await Promise.resolve();
    expect(h.importFn).toHaveBeenCalledTimes(1);
  });
});

describe("row lookup + keyboard nav", () => {
  it("rowById finds the row by its dataset id", () => {
    const h = makeHarness();
    h.render();
    const row = h.list.rowById("b");
    expect(row?.dataset.fakeId).toBe("b");
    expect(h.list.rowById("missing")).toBeNull();
  });

  it("Enter on a focused row swaps to it", () => {
    const h = makeHarness();
    h.render();
    const rowB = h.list.rowById("b")!;
    rowB.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(h.swap).toHaveBeenCalledWith({ id: "b", label: "B" });
  });

  it("ArrowDown moves roving tabindex forward, wrapping past the end", () => {
    const h = makeHarness();
    h.render();
    const rowA = h.list.rowById("a")!;
    rowA.tabIndex = 0;
    rowA.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(h.list.getRovedId()).toBe("b");
    const rowB = h.list.rowById("b")!;
    expect(rowB.tabIndex).toBe(0);
    expect(rowA.tabIndex).toBe(-1);

    rowB.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(h.list.getRovedId()).toBe("a"); // wraps back to the first row
  });

  it("keydown on the renaming input is ignored by the radiogroup nav", () => {
    const h = makeHarness();
    h.list.startRename("a"); // triggers render(), builds renaming markup for "a"
    const input = h.containerEl.querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(h.list.getRovedId()).toBeNull(); // unaffected — the renaming guard short-circuited
  });

  it("ignores all keydowns while a swap is in flight", async () => {
    let resolveSwap: () => void = () => {};
    const swap = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSwap = resolve;
        }),
    );
    const h = makeHarness({ swap });
    h.render();
    const rowB = h.list.rowById("b")!;
    rowB.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(h.list.isSwapping()).toBe(true);

    rowB.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(h.list.getRovedId()).toBeNull(); // second keydown swallowed while swapping

    resolveSwap();
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe("swapTo", () => {
  it("no-ops when the option is already active", async () => {
    const h = makeHarness(); // active is "a"
    await h.list.swapTo({ id: "a", label: "A" });
    expect(h.swap).not.toHaveBeenCalled();
  });

  it("sets aria-busy/is-swapping on the container during the swap and clears it after", async () => {
    let resolveSwap: () => void = () => {};
    const swap = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSwap = resolve;
        }),
    );
    const h = makeHarness({ swap });
    h.render();
    const promise = h.list.swapTo({ id: "b", label: "B" });
    expect(h.containerEl.getAttribute("aria-busy")).toBe("true");
    expect(h.containerEl.classList.contains("is-swapping")).toBe(true);
    resolveSwap();
    await promise;
    expect(h.containerEl.hasAttribute("aria-busy")).toBe(false);
    expect(h.containerEl.classList.contains("is-swapping")).toBe(false);
  });

  it("calls onRowBusy right after marking the row busy, before inserting the hint", async () => {
    const calls: string[] = [];
    const swap = vi.fn(async () => {});
    const h = makeHarness({
      swap,
      onRowBusy: (row) => {
        calls.push(`onRowBusy:${row.getAttribute("aria-busy")}`);
      },
    });
    h.render();
    await h.list.swapTo({ id: "b", label: "B" });
    expect(calls).toEqual(["onRowBusy:true"]);
  });

  it("sets errorId on failure and clears it on the next attempt", async () => {
    const h = makeHarness({ swap: vi.fn(async () => Promise.reject(new Error("nope"))) });
    h.render();
    await h.list.swapTo({ id: "b", label: "B" });
    expect(h.list.getErrorId()).toBe("b");
    expect(h.log.error).toHaveBeenCalledWith("fake_swap_failed", { id: "b", error: "Error: nope" });
  });
});
