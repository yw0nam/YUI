/** guide-docs.test.ts — a guide document as the backend reads it, through yui.guide.read. */

import { describe, expect, it } from "vitest";
import { runNamespace } from "../chat/tools/run/namespace-test-run";
import { createGuideApi, readGuide, renderGuideBlock } from "./guide-docs";

describe("readGuide", () => {
  it("returns the guide as the user reads it, without the site's pictures", () => {
    const text = readGuide("controls");
    expect(text).toContain("# Controls");
    expect(text).not.toContain("![");
  });
});

describe("renderGuideBlock", () => {
  it("names the controls guide and its yui.guide.read call instead of carrying the document", () => {
    const block = renderGuideBlock("controls");
    expect(block).toBe(
      'guide:\nThe user pressed the in-app help button for the controls guide. Read it with yui_run (return await yui.guide.read("controls")) and answer from it: start with the few most-used items, keep it short, and offer to go on; do not include links.',
    );
    expect(block).not.toContain("# Controls");
  });
});

describe("yui.guide.read", () => {
  it("returns the guide for a name that is a guide", async () => {
    const result = await runNamespace(
      "guide",
      createGuideApi().methods,
      'return await yui.guide.read("controls")',
    );
    expect(result).toEqual({
      status: "completed",
      result: readGuide("controls"),
      logs: [],
    });
    expect(result.status === "completed" ? result.result : "").toContain("# Controls");
  });

  it("ends the run with an error for a name that is not a guide", async () => {
    const result = await runNamespace(
      "guide",
      createGuideApi().methods,
      'return await yui.guide.read("x")',
    );
    expect(result).toMatchObject({
      status: "error",
      error: expect.stringMatching(/^Error: yui\.guide\.read: /),
    });
  });
});
