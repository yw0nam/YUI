/**
 * card-import.test.ts — the card file import step.
 *
 * Pins src/io/assets/card/card-import.ts: the OS picker → the Rust `import_card_file`
 * command → the card reader, with a PNG's temp thumbnail rolled back when the payload
 * holds no readable card. Deps are injectable so the suite never touches a real Tauri
 * runtime.
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
    openDialog: vi.fn(async () => "/Users/me/Downloads/mio.png"),
    invoke: vi.fn(async () => ({
      json: V2_JSON,
      thumbnailTempId: "mio-1a2b3c",
    })) as unknown as CardImportDeps["invoke"],
    removeThumbnail: vi.fn(async () => {}),
    ...over,
  };
}

function invokeReturning(json: string, thumbnailTempId: string | null): CardImportDeps["invoke"] {
  return vi.fn(async () => ({ json, thumbnailTempId })) as unknown as CardImportDeps["invoke"];
}

describe("importCardFromFile", () => {
  it("returns null when the picker is cancelled and invokes nothing", async () => {
    const deps = makeDeps({ openDialog: vi.fn(async () => null) });
    await expect(importCardFromFile(deps)).resolves.toBeNull();
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it("picks a single file among JSON and PNG cards", async () => {
    const deps = makeDeps();
    await importCardFromFile(deps);
    expect(deps.openDialog).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: [{ name: "Card", extensions: ["json", "png"] }],
    });
  });

  it("reads a JSON card with no temp thumbnail", async () => {
    const deps = makeDeps({
      openDialog: vi.fn(async () => "/Users/me/Downloads/mio.json"),
      invoke: invokeReturning(V2_JSON, null),
    });
    await expect(importCardFromFile(deps)).resolves.toEqual({
      card: expect.objectContaining({ name: "Mio", description: "picked card" }),
      thumbnailTempId: undefined,
    });
  });

  it("returns a PNG card's temp thumbnail id beside the card", async () => {
    const deps = makeDeps();
    const out = await importCardFromFile(deps);
    expect(deps.invoke).toHaveBeenCalledWith("import_card_file", {
      srcPath: "/Users/me/Downloads/mio.png",
    });
    expect(out?.thumbnailTempId).toBe("mio-1a2b3c");
    expect(out?.card).toEqual(expect.objectContaining({ name: "Mio" }));
  });

  it.each([
    ["unparsable JSON", "not json"],
    ["an unknown spec", JSON.stringify({ spec: "chara_card_v9", data: {} })],
  ])("rolls the temp thumbnail back and throws card_unreadable on %s", async (_label, json) => {
    const deps = makeDeps({ invoke: invokeReturning(json, "mio-1a2b3c") });
    await expect(importCardFromFile(deps)).rejects.toThrow("card_unreadable");
    expect(deps.removeThumbnail).toHaveBeenCalledWith("mio-1a2b3c");
  });
});
