/** thread-source.test.ts — the name and mark a Thread's source is drawn with. */

import { expect, it } from "vitest";
import { threadSource } from "./thread-source";

it.each([
  ["a known source by its table entry", "claude-code", { name: "Claude Code", mark: "✳" }],
  ["an unknown source by its raw text and first letter", "my-bot", { name: "my-bot", mark: "M" }],
  ["an unknown source whose first character is an emoji", "🤖bot", { name: "🤖bot", mark: "🤖" }],
])("draws %s", (_name, source, drawn) => {
  expect(threadSource(source)).toEqual(drawn);
});
