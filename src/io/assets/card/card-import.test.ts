/**
 * card-import.test.ts — the card file import step.
 *
 * Pins src/io/assets/card/card-import.ts: the Rust `import_card_file` command (which
 * opens the OS picker itself) → the card reader, the reserved-id and staging-id arguments,
 * the `.yui` result mapping, and the rollback of every claimed asset when the payload
 * holds no readable card; the `import_dropped_card` command for a file dropped onto the
 * settings window. Deps are injectable so the suite never touches a real Tauri
 * runtime.
 */

import { describe, expect, it, vi } from "vitest";
import type { CardImportDeps } from "./card-import";
import { importCardFromDrop, importCardFromFile } from "./card-import";

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
      source: "png",
    })) as unknown as CardImportDeps["invoke"],
    removeThumbnail: vi.fn(async () => {}),
    removeUserVrm: vi.fn(async () => {}),
    removeUserVoice: vi.fn(async () => {}),
    convertFileSrc: (path: string) => `asset://localhost${path}`,
    ...over,
  };
}

function invokeReturning(file: unknown): CardImportDeps["invoke"] {
  return vi.fn(async () => file) as unknown as CardImportDeps["invoke"];
}

describe("importCardFromFile", () => {
  it("returns null when the picker is cancelled in Rust and invokes nothing else", async () => {
    const deps = makeDeps({ invoke: invokeReturning(null) });
    await expect(importCardFromFile([], "import-0", deps)).resolves.toBeNull();
    expect(deps.invoke).toHaveBeenCalledTimes(1);
  });

  it("reads a JSON card with no temp thumbnail", async () => {
    const deps = makeDeps({
      invoke: invokeReturning({ json: V2_JSON, thumbnailTempId: null, source: "json" }),
    });
    await expect(importCardFromFile([], "import-0", deps)).resolves.toEqual({
      card: expect.objectContaining({ name: "Mio", description: "picked card" }),
      source: "json",
      thumbnailTempId: undefined,
    });
  });

  it("returns a PNG card's temp thumbnail id beside the card", async () => {
    const deps = makeDeps();
    const out = await importCardFromFile([], "import-0", deps);
    expect(out?.thumbnailTempId).toBe("mio-1a2b3c");
    expect(out?.card).toEqual(expect.objectContaining({ name: "Mio" }));
  });

  it("passes the reserved ids and staging id to the command and maps a .yui result", async () => {
    const deps = makeDeps({
      invoke: invokeReturning({
        json: V2_JSON,
        thumbnailTempId: "mio-1a2b3c",
        source: "yui",
        crop: { x: 0.25, y: 0, size: 0.5 },
        vrm: { kind: "user", id: "mio_vrm", destPath: "/vrms/mio_vrm/model.vrm", label: "Mio" },
        voice: { id: "import-9", refPath: "/references/import-9/clip.wav", label: "Mio" },
      }),
    });
    const out = await importCardFromFile(["carlotta"], "import-9", deps);

    expect(deps.invoke).toHaveBeenCalledWith("import_card_file", {
      reservedVrmIds: ["carlotta"],
      voiceStagingId: "import-9",
    });
    expect(out).toEqual({
      card: expect.objectContaining({ name: "Mio" }),
      thumbnailTempId: "mio-1a2b3c",
      source: "yui",
      crop: { x: 0.25, y: 0, size: 0.5 },
      vrm: {
        kind: "user",
        id: "mio_vrm",
        url: "asset://localhost/vrms/mio_vrm/model.vrm",
        label: "Mio",
      },
      voice: {
        stagedId: "import-9",
        refUrl: "asset://localhost/references/import-9/clip.wav",
        label: "Mio",
      },
    });
  });

  it.each([
    ["unparsable JSON", "not json"],
    ["an unknown spec", JSON.stringify({ spec: "chara_card_v9", data: {} })],
  ])("rolls the temp thumbnail back and throws card_unreadable on %s", async (_label, json) => {
    const deps = makeDeps({ invoke: invokeReturning({ json, thumbnailTempId: "mio-1a2b3c" }) });
    await expect(importCardFromFile([], "import-0", deps)).rejects.toThrow("card_unreadable");
    expect(deps.removeThumbnail).toHaveBeenCalledWith("mio-1a2b3c");
  });

  it("removes every claimed asset when a preset file's card is unreadable", async () => {
    const deps = makeDeps({
      invoke: invokeReturning({
        json: "not json",
        thumbnailTempId: "mio-1a2b3c",
        source: "yui",
        vrm: { kind: "user", id: "mio_vrm", destPath: "/vrms/mio_vrm/model.vrm" },
        voice: { id: "import-9", refPath: "/references/import-9/clip.wav", label: "Mio" },
      }),
    });
    await expect(importCardFromFile(["carlotta"], "import-9", deps)).rejects.toThrow(
      "card_unreadable",
    );

    expect(deps.removeThumbnail).toHaveBeenCalledWith("mio-1a2b3c");
    expect(deps.removeUserVrm).toHaveBeenCalledWith("mio_vrm");
    expect(deps.removeUserVoice).toHaveBeenCalledWith("import-9");
  });
});

describe("importCardFromDrop", () => {
  it("invokes import_dropped_card with no path and returns the card", async () => {
    const deps = makeDeps();
    const out = await importCardFromDrop(["carlotta"], "import-9", deps);

    expect(deps.invoke).toHaveBeenCalledWith("import_dropped_card", {
      reservedVrmIds: ["carlotta"],
      voiceStagingId: "import-9",
    });
    expect(out).toEqual({
      card: expect.objectContaining({ name: "Mio", description: "picked card" }),
      thumbnailTempId: "mio-1a2b3c",
      source: "png",
    });
  });

  it("rolls the temp thumbnail back and throws card_unreadable on an unreadable payload", async () => {
    const deps = makeDeps({
      invoke: invokeReturning({ json: "not json", thumbnailTempId: "mio-1a2b3c", source: "png" }),
    });
    await expect(importCardFromDrop([], "import-0", deps)).rejects.toThrow("card_unreadable");
    expect(deps.removeThumbnail).toHaveBeenCalledWith("mio-1a2b3c");
  });
});
