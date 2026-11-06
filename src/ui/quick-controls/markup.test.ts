import { describe, expect, it } from "vitest";
import { numRowHtml } from "./markup";

describe("numRowHtml", () => {
  it("sizes the field for the digits of its max", () => {
    const html = numRowHtml({
      id: "port",
      labelKey: "reactions.port_label",
      min: 1024,
      max: 65535,
    });
    expect(html).toContain('data-digits="5"');
  });
});
