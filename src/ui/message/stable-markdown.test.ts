import { expect, it } from "vitest";
import { stableMarkdown } from "./stable-markdown";

it.each([
  ["plain words show as they arrive", "Hello wor", "Hello wor"],
  ["an unclosed link waits", "See [docs](https://exa", "See "],
  [
    "a closed link shows",
    "See [docs](https://example.com) now",
    "See [docs](https://example.com) now",
  ],
  ["a label still waiting for its target waits", "See [docs]", "See "],
  ["unclosed bold waits", "Say **hi", "Say "],
  ["unclosed emphasis waits", "Say *hi", "Say "],
  ["a bullet star is no emphasis", "* one", "* one"],
  ["an unclosed code span waits", "Run `pnpm", "Run "],
  ["a bare URL still arriving waits", "Open https://example.co", "Open "],
  ["a word that may start a URL waits", "Open htt", "Open "],
  ["an intraword underscore is no emphasis", "snake_case", "snake_case"],
])("%s", (_case, raw, stable) => {
  expect(stableMarkdown(raw)).toBe(stable);
});
