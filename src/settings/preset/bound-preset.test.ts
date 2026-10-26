import { expect, it } from "vitest";
import { readBoundPresetId, readEditPresetId, readSettingsPage } from "./bound-preset";

it.each([
  ["?preset=3f9a1c2e", "3f9a1c2e"],
  ["?preset=default", "default"],
  ["?preset=", null],
  ["", null],
  ["?x=1&preset=ab", "ab"],
])("reads %s", (search, id) => {
  expect(readBoundPresetId(search!)).toBe(id);
});

it.each([
  ["?preset=a&edit=b", "b"],
  ["?preset=a", null],
])("reads the edit target of %s", (search, id) => {
  expect(readEditPresetId(search)).toBe(id);
});

it.each([
  ["?page=conn", "conn"],
  ["?preset=a&page=general", "general"],
  ["?page=nope", null],
  ["?page=", null],
  ["", null],
])("reads the settings page of %s", (search, page) => {
  expect(readSettingsPage(search)).toBe(page);
});
