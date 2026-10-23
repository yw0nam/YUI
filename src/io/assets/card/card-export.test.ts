/**
 * card-export.test.ts — the card export file step.
 *
 * Pins src/io/assets/card/card-export.ts: the OS save dialog → the Rust `write_card_file`
 * command, the cancelled path, and the export file-name sanitizer.
 */

import { describe, expect, it, vi } from "vitest";
import type { CardExportDeps } from "./card-export";
import { exportCardToFile, sanitizeFileStem } from "./card-export";

function makeDeps(over: Partial<CardExportDeps> = {}): CardExportDeps {
  return {
    saveDialog: vi.fn(async () => "/Users/me/Desktop/Mio.json"),
    invoke: vi.fn(async () => undefined) as unknown as CardExportDeps["invoke"],
    ...over,
  };
}

describe("exportCardToFile", () => {
  it("returns cancelled when the save dialog is dismissed and writes nothing", async () => {
    const deps = makeDeps({ saveDialog: vi.fn(async () => null) });
    await expect(exportCardToFile("{}", "Mio.json", deps)).resolves.toBe("cancelled");
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it("offers the JSON filter with the given default name", async () => {
    const deps = makeDeps();
    await exportCardToFile("{}", "Mio.json", deps);
    expect(deps.saveDialog).toHaveBeenCalledWith({
      defaultPath: "Mio.json",
      filters: [{ name: "Card", extensions: ["json"] }],
    });
  });

  it("writes the card text to the picked path", async () => {
    const deps = makeDeps();
    await expect(exportCardToFile('{"name":"Mio"}', "Mio.json", deps)).resolves.toBe("written");
    expect(deps.invoke).toHaveBeenCalledWith("write_card_file", {
      destPath: "/Users/me/Desktop/Mio.json",
      text: '{"name":"Mio"}',
    });
  });
});

describe("sanitizeFileStem", () => {
  it.each([
    ["Mio/Natsume", "Mio_Natsume"],
    ["bad\tname\n", "bad_name_"],
    ["   ", "card"],
  ])("strips separators and control characters from %s", (name, expected) => {
    expect(sanitizeFileStem(name)).toBe(expected);
  });
});
