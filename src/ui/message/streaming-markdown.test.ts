// @vitest-environment jsdom
import { expect, it } from "vitest";
import { renderMarkdownInline } from "./markdown";
import { stableMarkdown } from "./stable-markdown";
import { createStreamingMarkdown } from "./streaming-markdown";
import { keepTextPrefix, visibleText } from "./text-prefix";

const BODY = [
  "# A long reply\n\n",
  "A paragraph with **bold**, *emphasis*, ~~strike~~, `code`, &amp; [a link](https://example.org).\n\n",
  "- First item\n- Second item with *words*\n\n1. One\n2. Two\n\n> Quoted words\n\n",
  "```ts\nconst answer = 42;\n```\n\n",
  "| A | B |\n| - | - |\n| one | two |\n\n",
  "![image](https://example.org/a.png)\n\n",
  "The shortcut [later] resolves once its definition arrives.\n\n",
  ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i}: ${"ordinary words ".repeat(15)}\n\n`),
];
const TAIL = "A closing line.\n\n[later]: https://example.org/later\n";
const RAW_HTML = [
  "Strip <script>alert(1)</script>this and <iframe src=x></iframe>that.\n\n",
  "a <em>x\n\nb</em> c\n\n",
  '<a href="https://example.org">one\n\ntwo</a> three\n\n',
];

// The bubble's render path before blocks were kept: the whole line rendered on every parse, cloned and cut on every reveal.
function previousRender(parsed: HTMLElement | null, text: string, count: number): string {
  const host = document.createElement("div");
  if (parsed === null) return host.innerHTML;
  const shown = parsed.cloneNode(true);
  if (count < text.length) keepTextPrefix(shown, count);
  host.replaceChildren(shown);
  return host.innerHTML;
}

it.each([
  ["markdown", [...BODY, TAIL].join("")],
  ["raw HTML", [...BODY.slice(0, 4), ...RAW_HTML, ...BODY.slice(4), TAIL].join("")],
])("renders a streamed %s line as the whole-line renderer did, at every chunk and reveal", (_case, sample) => {
  const markdown = createStreamingMarkdown();
  const host = document.createElement("div");
  let seed = 17;
  for (let end = 0; ; ) {
    const final = end === sample.length;
    const source = final ? sample : stableMarkdown(sample.slice(0, end));
    const text = markdown.update(source, !final);
    const parsed = source === "" ? null : renderMarkdownInline(source, { streaming: !final });
    expect(text).toBe(parsed === null ? "" : visibleText(parsed));
    for (const count of [
      0,
      Math.floor(text.length / 3),
      Math.max(0, text.length - 1),
      text.length,
    ]) {
      markdown.render(host, count);
      expect(host.innerHTML, `source ${end}, reveal ${count}`).toBe(
        previousRender(parsed, text, count),
      );
    }
    if (final) break;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    end = Math.min(sample.length, end + 1 + (seed % 199));
  }
});
