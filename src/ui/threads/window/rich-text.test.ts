// @vitest-environment jsdom
/** rich-text.test.ts — producer text drawn as text, with code spans and fenced code and nothing else. */

import { expect, it } from "vitest";
import { richText } from "./rich-text";

function render(text: string): HTMLElement {
  const host = document.createElement("div");
  host.append(richText(text));
  return host;
}

it("renders markup in producer text as text, in prose, code spans and fenced code", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const host = render(`${evil} \`${evil}\`\n\`\`\`html\n${evil}\n\`\`\``);

  expect(host.querySelector("img")).toBe(null);
  expect(host.querySelector(":scope > code")!.textContent).toBe(evil);
  expect(host.querySelector("pre > code")!.textContent).toBe(`${evil}\n`);
  expect(host.textContent).toBe(`${evil} ${evil}\n${evil}\n`);
});
