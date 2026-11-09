/**
 * card-export.test.ts — the default file-name sanitizer of src/io/assets/card/card-export.ts.
 */

import { describe, expect, it } from "vitest";
import { sanitizeFileStem } from "./card-export";

describe("sanitizeFileStem", () => {
  it.each([
    ["Mio/Natsume", "Mio_Natsume"],
    ["bad\tname\n", "bad_name_"],
    ["   ", "card"],
  ])("strips separators and control characters from %s", (name, expected) => {
    expect(sanitizeFileStem(name)).toBe(expected);
  });
});
