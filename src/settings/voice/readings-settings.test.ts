import { describe, expect, it } from "vitest";
import { createReadingsSettings } from "./readings-settings";

describe("createReadingsSettings", () => {
  it("keeps ignored lines as typed across a reload", () => {
    let saved: { text: string } | null = null;
    const storage = { load: () => saved, save: (v: { text: string }) => (saved = v) };
    createReadingsSettings({ storage }).setText("秧秧=ヤンヤン\nnoequals");
    expect(createReadingsSettings({ storage }).get()).toEqual({
      text: "秧秧=ヤンヤン\nnoequals",
    });
  });
});
