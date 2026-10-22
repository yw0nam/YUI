import { expect, it } from "vitest";
import { editTargetUrl } from "./edit-target-url";

it.each([
  ["http://localhost/settings.html", "b", "a", "http://localhost/settings.html?edit=b"],
  ["http://localhost/settings.html?edit=c", "b", "a", "http://localhost/settings.html?edit=b"],
  [
    "http://localhost/settings.html?preset=a&edit=b",
    "a",
    "a",
    "http://localhost/settings.html?preset=a",
  ],
])("editTargetUrl of %s to %s over own %s is %s", (href, id, own, expected) => {
  expect(editTargetUrl(href, id, own)).toBe(expected);
});
