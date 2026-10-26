// @vitest-environment jsdom
import { expect, it } from "vitest";
import { renderMarkdownInline } from "./markdown";
import { stableMarkdown } from "./stable-markdown";
import { visibleText } from "./text-prefix";

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
  ["a trailing marker waits for what follows it", "Say *", "Say "],
  ["a bullet star is no emphasis", "* one", "* one"],
  ["an unclosed code span waits", "Run `pnpm", "Run "],
  [
    "a bare URL shows as text while it arrives",
    "Open https://example.co",
    "Open https://example.co",
  ],
  ["an intraword underscore is no emphasis", "snake_case", "snake_case"],
  ["an escaped marker is text", "Price is \\*5 and more", "Price is \\*5 and more"],
  ["a trailing backslash waits", "Price is \\", "Price is "],
  ["a less-than before a digit is text", "if x<5 then", "if x<5 then"],
  ["an angle that may open a tag waits", "Ask <https://exa", "Ask "],
  ["a last line of block markers waits", "One\n- ", "One\n"],
  ["an unterminated entity waits", "use &amp", "use "],
])("%s", (_case, raw, stable) => {
  expect(stableMarkdown(raw)).toBe(stable);
});

function rendered(source: string, streaming: boolean): { text: string; hrefs: (string | null)[] } {
  if (source === "") return { text: "", hrefs: [] };
  const el = renderMarkdownInline(source, { streaming });
  return {
    text: visibleText(el),
    hrefs: [...el.querySelectorAll("a")].map((a) => a.getAttribute("href")),
  };
}

it.each([
  "Here is **bold** and [label](https://example.com/x) now.",
  "Say *hi* there",
  "Say _hi_ there",
  "Price is \\*5 and more text follows here.",
  "if x<5 then y is small, and more text.",
  "***wow*** ok then more text",
  "about ~5 to ~10 minutes",
  "mail me at foo@example.com today",
  "see [x](https://en.wikipedia.org/wiki/Foo_(bar)) ok",
  "Title\n---\nbody",
  "- one\n- two\n\nok",
  "1. first\n2. second",
  "# Heading\ntext",
  "```\ncode\n```\nafter",
  "> quote\nmore",
  "a `code` b",
  "use &amp; and &copy; ok",
  "![img](https://example.com/a.png) hi",
  "<b>bold</b> text",
  "visit www.example.com/path now",
  "visit https://example.com/path now",
  "Use snake_case_names and __init__ here",
  "2 * 3 * 4 = 24 ok",
  "a [b] c [d](https://e.f) g",
  "x_1 and *note* done",
  "**Note:** something",
  "Ask: <https://example.com/a> ok",
  "Visit http://example.com. Then",
  "<foo@bar.com> ok",
  "Read https://example.com/a_b_c ok",
  "| a | b |\n|---|---|\n| 1 | 2 |",
  "Hello\n\n---\n\nbye",
  "Hmm... *sigh* ok",
  "Hmm, *sigh* that again",
  "これは**重要**です",
  "Line *a\nb* c",
  "I'm 5'10\" and *very* tall",
  "One\nTwo\nThree\n",
  'a [link](https://x.y "title") b',
  "see [ref][1] ok\n\n[1]: https://x.y",
  "a ``co`de`` b",
  "text [x](<https://a.b/c d>) ok",
  "go to example.com today",
  "Wow!! *nice*",
  "_*both*_ end",
  "a **b *c* d** e",
  "tilde ~x~ ok",
  "ok :) (see [a](https://b.c)) end",
])("streams %j: each prefix shows a prefix of the final text, and every href is final", (raw) => {
  const final = rendered(raw, false);
  const wrong: string[] = [];
  for (let i = 1; i <= raw.length; i++) {
    const prefix = raw.slice(0, i);
    const shown = rendered(stableMarkdown(prefix), true);
    if (!final.text.startsWith(shown.text))
      wrong.push(`${JSON.stringify(prefix)} shows ${JSON.stringify(shown.text)}`);
    for (const href of shown.hrefs) {
      if (!final.hrefs.includes(href)) wrong.push(`${JSON.stringify(prefix)} links ${href}`);
    }
  }
  expect(wrong).toEqual([]);
});
