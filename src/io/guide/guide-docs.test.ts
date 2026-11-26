/** guide-docs.test.ts — a guide document as the backend reads it, through yui.guide.read. */

import { describe, expect, it } from "vitest";
import { runNamespace } from "../chat/tools/run/namespace-test-run";
import { createGuideApi, readGuide } from "./guide-docs";

describe("readGuide", () => {
  it("returns the guide as the user reads it, without the site's pictures", () => {
    const text = readGuide("controls");
    expect(text).toContain("# Controls");
    expect(text).not.toContain("![");
  });
});

describe("yui.guide.read", () => {
  it("ends the run with an error for a name that is not a guide", async () => {
    const result = await runNamespace(
      "guide",
      createGuideApi().methods,
      'return await yui.guide.read("x")',
    );
    expect(result).toMatchObject({ status: "error" });
    expect(result.status === "error" ? result.error : "").toMatch(/^Error: yui\.guide\.read: /);
  });
});
