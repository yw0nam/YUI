/**
 * card-export.test.ts — the card export file step.
 *
 * Pins src/io/assets/card/card-export.ts: the Rust `export_card_file` command (which
 * opens the OS save dialog itself), the cancelled path, and the default file-name
 * sanitizer.
 */

import { describe, expect, it, vi } from "vitest";
import type { CardExportDeps } from "./card-export";
import { exportCardToFile, sanitizeFileStem } from "./card-export";

function makeDeps(over: Partial<CardExportDeps> = {}): CardExportDeps {
  return {
    invoke: vi.fn(async () => true) as unknown as CardExportDeps["invoke"],
    ...over,
  };
}

describe("exportCardToFile", () => {
  it("returns cancelled when the save dialog is dismissed and writes nothing", async () => {
    const deps = makeDeps({
      invoke: vi.fn(async () => false) as unknown as CardExportDeps["invoke"],
    });
    await expect(exportCardToFile("{}", "Mio.json", deps)).resolves.toBe("cancelled");
  });

  it("hands the default name and the card text to the command", async () => {
    const deps = makeDeps();
    await expect(exportCardToFile('{"name":"Mio"}', "Mio.json", deps)).resolves.toBe("written");
    expect(deps.invoke).toHaveBeenCalledWith("export_card_file", {
      defaultName: "Mio.json",
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
