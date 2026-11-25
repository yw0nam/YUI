import { beforeEach, expect, it, vi } from "vitest";

let store: typeof import("./last-emotion");

beforeEach(async () => {
  vi.resetModules();
  store = await import("./last-emotion");
});

it.each([
  ["neutral with nothing recorded", [], "neutral"],
  ["the id inside the decay window", [["angry", 1_000]], "angry"],
  ["neutral once the record is older than the decay window", [["angry", -60_000]], "neutral"],
  [
    "the earlier id over an empty one",
    [
      ["angry", 1_000],
      ["", 2_000],
    ],
    "angry",
  ],
  [
    "the earlier id over one that is not a string",
    [
      ["angry", 1_000],
      [42, 2_000],
    ],
    "angry",
  ],
] as const)("reads %s", (_, records, expected) => {
  for (const [id, atMs] of records) store.recordBackendEmotion(id as string, atMs);

  expect(store.lastBackendEmotion(31_000, 60_000)).toBe(expected);
});
