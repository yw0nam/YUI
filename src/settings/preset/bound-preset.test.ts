import { expect, it } from "vitest";
import { readBoundPresetId } from "./bound-preset";

it.each([
  ["?preset=3f9a1c2e", "3f9a1c2e"],
  ["?preset=default", "default"],
  ["?preset=", null],
  ["", null],
  ["?x=1&preset=ab", "ab"],
])("reads %s", (search, id) => {
  expect(readBoundPresetId(search!)).toBe(id);
});
