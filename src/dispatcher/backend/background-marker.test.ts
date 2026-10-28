import { describe, expect, it } from "vitest";
import type { TriggerMeta } from "../../contract";
import { backgroundMarker } from "./background-marker";

describe("backgroundMarker — addressed markers", () => {
  it("names the speaker for addressed.character", () => {
    expect(
      backgroundMarker("addressed.character", {
        addressed: { from: "perlica", text: "natsume, you took my chair", ts: 1 },
      } as TriggerMeta),
    ).toBe("(perlica just spoke to you)");
  });

  it("falls back to the default marker when the addressed field is absent", () => {
    expect(backgroundMarker("addressed.character", {} as TriggerMeta)).toBe(
      "(something just caught your attention)",
    );
  });

  it("collapses newlines and clamps a long speaker name to one line", () => {
    const from = `perlica\n\n${"x".repeat(60)}`;
    const marker = backgroundMarker("addressed.character", {
      addressed: { from, text: "natsume, you took my chair", ts: 1 },
    } as TriggerMeta);
    expect(marker).toBe(`(perlica ${"x".repeat(32)} just spoke to you)`);
    expect(marker).not.toContain("\n");
  });
});

describe("backgroundMarker — signals markers", () => {
  it.each([
    ["signals.urgent", "(something urgent just came in for you)"],
    ["signals.catchup", "(signals piled up for you)"],
    ["signals.urgent_catchup", "(urgent things piled up for you)"],
  ])("%s", (eventName, marker) => {
    expect(backgroundMarker(eventName, {} as TriggerMeta)).toBe(marker);
  });
});
