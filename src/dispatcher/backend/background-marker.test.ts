import { describe, expect, it } from "vitest";
import type { TriggerMeta } from "../../contract";
import { backgroundMarker } from "./background-marker";

describe("backgroundMarker — signals markers", () => {
  it.each([
    ["signals.urgent", "(something urgent just came in for you)"],
    ["signals.catchup", "(signals piled up for you)"],
    ["signals.urgent_catchup", "(urgent things piled up for you)"],
  ])("%s", (eventName, marker) => {
    expect(backgroundMarker(eventName, {} as TriggerMeta)).toBe(marker);
  });
});
