// @vitest-environment jsdom
/**
 * pending-import.test.ts — the staged-import lifecycle: pick → naming row → commit/discard.
 *
 * Pins the module's public surface directly; the list's wiring of the same flow is pinned
 * by user-asset-list.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../../logger";
import {
  createPendingImport,
  type PendingImport,
  type PendingImportConfig,
} from "./pending-import";

function makeLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePending(stagedId = "import-1", seedName = "x"): PendingImport {
  return { stagedId, seedName, discard: vi.fn(async () => {}) };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function makeFlow(overrides: Partial<PendingImportConfig> = {}) {
  const importErrorEl = document.createElement("p");
  importErrorEl.hidden = true;
  const cfg = {
    pickImport: vi.fn<() => Promise<PendingImport | null>>(),
    commitImport: vi.fn<(stagedId: string, name: string) => Promise<void>>(async () => {}),
    deriveId: (name: string): string => name.trim(),
    hasId: (): boolean => false,
    importErrorEl,
    log: makeLog(),
    logPrefix: "fake",
    i18nNamespace: "vrm", // reuse an existing real i18n namespace so t() resolves to real strings
    rowClasses: {
      renaming: "yui-fake--renaming",
      tick: "yui-fake__tick",
      renameHint: "yui-fake__rename-hint",
      overwriteWarn: "yui-fake__overwrite-warn",
    },
    render: vi.fn(),
    ...overrides,
  };
  return { flow: createPendingImport(cfg), cfg, render: vi.mocked(cfg.render) };
}

describe("createPendingImport", () => {
  it("one picker at a time: a second start() while the first pick is unresolved does not call pickImport again", async () => {
    const pickImport = vi.fn<() => Promise<PendingImport | null>>(
      () => new Promise(() => {}), // never resolves — the picker is open
    );
    const { flow } = makeFlow({ pickImport });

    void flow.start();
    await flush();
    void flow.start();
    await flush();

    expect(pickImport).toHaveBeenCalledTimes(1);
  });

  it("Escape on the naming row discards the staged copy once and closes the row", async () => {
    const staged = makePending();
    const { flow, render } = makeFlow({ pickImport: vi.fn(async () => staged) });
    await flow.start();
    const row = document.createElement("div");
    flow.renderRow(row, staged);
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

    expect(staged.discard).toHaveBeenCalledTimes(1);
    expect(flow.get()).toBeNull();
    expect(render).toHaveBeenCalledTimes(2);
    flow.cancel();
    expect(staged.discard).toHaveBeenCalledTimes(1); // already discarded — cancel does not re-discard
  });

  it("a rejected pick shows the inline error and logs import_failed", async () => {
    const { flow, cfg } = makeFlow({
      pickImport: vi.fn(async () => {
        throw new Error("unsupported audio type");
      }),
    });

    await flow.start();

    expect(cfg.importErrorEl.hidden).toBe(false);
    expect(cfg.log.error).toHaveBeenCalledTimes(1);
    expect(cfg.log.error).toHaveBeenCalledWith("fake_import_failed", {
      error: "Error: unsupported audio type",
    });
    expect(flow.get()).toBeNull();
  });

  it("dispose() with a staged import discards it once", async () => {
    const staged = makePending();
    const { flow } = makeFlow({ pickImport: vi.fn(async () => staged) });
    await flow.start();

    flow.dispose();

    expect(staged.discard).toHaveBeenCalledTimes(1);
    expect(flow.get()).toBeNull();
  });

  it("a pick that resolves after dispose() is discarded and renders no naming row", async () => {
    const staged = makePending();
    let resolvePick: (v: PendingImport) => void = () => {};
    const { flow, render } = makeFlow({
      pickImport: vi.fn(
        () =>
          new Promise<PendingImport>((resolve) => {
            resolvePick = resolve;
          }),
      ),
    });
    void flow.start();
    await flush();

    flow.dispose();
    resolvePick(staged);
    await flush();

    expect(staged.discard).toHaveBeenCalledTimes(1);
    expect(flow.get()).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it("commit uploads the staged copy under the typed name", async () => {
    const staged = makePending("import-1", "natsume");
    const insideCommit = { rowClosed: false, committing: false };
    const commitImport = vi.fn<(stagedId: string, name: string) => Promise<void>>(async () => {
      insideCommit.rowClosed = flow.get() === null;
      insideCommit.committing = flow.isCommitting();
    });
    const { flow, render } = makeFlow({ pickImport: vi.fn(async () => staged), commitImport });
    await flow.start();
    render.mockClear();

    await flow.commit("Natsume");

    expect(commitImport).toHaveBeenCalledTimes(1);
    expect(commitImport).toHaveBeenCalledWith("import-1", "Natsume");
    expect(insideCommit.rowClosed).toBe(true);
    expect(insideCommit.committing).toBe(true);
    expect(render).toHaveBeenCalledTimes(2); // before and after the upload
    expect(flow.get()).toBeNull();
  });

  it("a blocked id keeps the naming row open", async () => {
    const staged = makePending();
    const commitImport = vi.fn<(stagedId: string, name: string) => Promise<void>>(async () => {});
    const { flow } = makeFlow({
      pickImport: vi.fn(async () => staged),
      commitImport,
      isImportBlocked: (): boolean => true,
    });
    await flow.start();

    await flow.commit("Natsume");

    expect(commitImport).not.toHaveBeenCalled();
    expect(flow.get()).toBe(staged);
  });
});
