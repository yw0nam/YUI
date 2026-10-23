import { describe, expect, it } from "vitest";
import type { TriggerMeta } from "../../contract";
import { backgroundMarker } from "./background-marker";

describe("backgroundMarker — urgent signals", () => {
  it.each([
    ["signals.urgent", "(something urgent just came in for you)"],
    ["signals.urgent_catchup", "(urgent things piled up while I was away)"],
  ])("%s", (eventName, marker) => {
    expect(backgroundMarker(eventName, {} as TriggerMeta)).toBe(marker);
  });
});
