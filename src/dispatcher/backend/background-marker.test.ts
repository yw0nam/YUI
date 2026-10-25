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
