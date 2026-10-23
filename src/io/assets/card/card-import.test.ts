/**
 * card-import.test.ts — the card file import step.
 *
 * Pins src/io/assets/card/card-import.ts: the Rust `import_card_file` command (which
 * opens the OS picker itself) → the card reader, with a PNG's temp thumbnail rolled back
 * when the payload holds no readable card. Deps are injectable so the suite never touches
 * a real Tauri runtime.
 */

import { describe, expect, it, vi } from "vitest";
import type { CardImportDeps } from "./card-import";
import { importCardFromFile } from "./card-import";

const V2_JSON = JSON.stringify({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: { name: "Mio", description: "picked card" },
});

function makeDeps(over: Partial<CardImportDeps> = {}): CardImportDeps {
  return {
    invoke: vi.fn(async () => ({
      json: V2_JSON,
      thumbnailTempId: "mio-1a2b3c",
    })) as unknown as CardImportDeps["invoke"],
    removeThumbnail: vi.fn(async () => {}),
    ...over,
  };
}

function invokeReturning(file: unknown): CardImportDeps["invoke"] {
  return vi.fn(async () => file) as unknown as CardImportDeps["invoke"];
}

describe("importCardFromFile", () => {
  it("returns null when the picker is cancelled in Rust and invokes nothing else", async () => {
    const deps = makeDeps({ invoke: invokeReturning(null) });
    await expect(importCardFromFile(deps)).resolves.toBeNull();
    expect(deps.invoke).toHaveBeenCalledTimes(1);
  });

  it("invokes import_card_file with no path argument", async () => {
    const deps = makeDeps();
    await importCardFromFile(deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_card_file");
  });

  it("reads a JSON card with no temp thumbnail", async () => {
    const deps = makeDeps({ invoke: invokeReturning({ json: V2_JSON, thumbnailTempId: null }) });
    await expect(importCardFromFile(deps)).resolves.toEqual({
      card: expect.objectContaining({ name: "Mio", description: "picked card" }),
      thumbnailTempId: undefined,
    });
  });

  it("returns a PNG card's temp thumbnail id beside the card", async () => {
    const deps = makeDeps();
    const out = await importCardFromFile(deps);
    expect(out?.thumbnailTempId).toBe("mio-1a2b3c");
    expect(out?.card).toEqual(expect.objectContaining({ name: "Mio" }));
  });

  it.each([
    ["unparsable JSON", "not json"],
    ["an unknown spec", JSON.stringify({ spec: "chara_card_v9", data: {} })],
  ])("rolls the temp thumbnail back and throws card_unreadable on %s", async (_label, json) => {
    const deps = makeDeps({ invoke: invokeReturning({ json, thumbnailTempId: "mio-1a2b3c" }) });
    await expect(importCardFromFile(deps)).rejects.toThrow("card_unreadable");
    expect(deps.removeThumbnail).toHaveBeenCalledWith("mio-1a2b3c");
  });
});
