// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createStreamingMarkdown } from "./streaming-markdown";

const ALL = Number.POSITIVE_INFINITY;
const OUT = 'target="_blank" rel="noopener noreferrer"';

interface Step {
  source: string;
  streaming: boolean;
  shown: [count: number, html: string][];
}

it.each<[string, Step[]]>([
  [
    "mixed markdown",
    [
      {
        source: "# Title\n\nSome **bold** and *soft* words.\n\n",
        streaming: true,
        shown: [
          [7, "<span><h1>Title</h1>\n<p>So</p></span>"],
          [
            ALL,
            "<span><h1>Title</h1>\n<p>Some <strong>bold</strong> and <em>soft</em> words.</p></span>",
          ],
        ],
      },
      {
        source:
          "# Title\n\nSome **bold** and *soft* words.\n\n- one\n- two\n\n```\ncode\n```\n\n![cat](https://example.org/c.png) and [a link](https://example.org).",
        streaming: true,
        shown: [
          [
            ALL,
            `<span><h1>Title</h1>\n<p>Some <strong>bold</strong> and <em>soft</em> words.</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<pre><code>code\n</code></pre>\n<p><img src="https://example.org/c.png" alt="cat" loading="lazy"> and <a href="https://example.org" ${OUT}>a link</a>.</p></span>`,
          ],
        ],
      },
    ],
  ],
  [
    "raw HTML across blocks",
    [
      {
        source: "a <em>x\n\nb</em> c\n\n",
        streaming: true,
        shown: [[ALL, "<span><p>a <em>x</em></p><em>\n</em><p><em>b</em> c</p></span>"]],
      },
      {
        source: 'a <em>x\n\nb</em> c\n\n<a href="https://example.org">one\n\ntwo</a> three',
        streaming: true,
        shown: [
          [4, "<span><p>a <em>x</em></p><em>\n</em><p><em>b</em></p></span>"],
          [
            ALL,
            `<span><p>a <em>x</em></p><em>\n</em><p><em>b</em> c</p>\n<p><a href="https://example.org" ${OUT}>one</a></p><a href="https://example.org" ${OUT}>\n</a><p><a href="https://example.org" ${OUT}>two</a> three</p></span>`,
          ],
        ],
      },
    ],
  ],
  [
    "a cut inside an earlier block",
    [
      {
        source: "First paragraph.\n\nSecond paragraph.",
        streaming: true,
        shown: [[ALL, "<span><p>First paragraph.</p>\n<p>Second paragraph.</p></span>"]],
      },
      {
        source: "First paragraph.\n\nSecond paragraph.\n\nThird.",
        streaming: true,
        shown: [
          [3, "<span><p>Fir</p></span>"],
          [20, "<span><p>First paragraph.</p>\n<p>Seco</p></span>"],
          [ALL, "<span><p>First paragraph.</p>\n<p>Second paragraph.</p>\n<p>Third.</p></span>"],
        ],
      },
    ],
  ],
  [
    "a reference definition arriving after its use",
    [
      {
        source: "See [later] now.\n\n",
        streaming: true,
        shown: [[ALL, "<span><p>See [later] now.</p></span>"]],
      },
      {
        source: "See [later] now.\n\n[later]: https://example.org/x\n",
        streaming: true,
        shown: [
          [ALL, `<span><p>See <a href="https://example.org/x" ${OUT}>later</a> now.</p></span>`],
        ],
      },
    ],
  ],
  [
    "a bare URL once the line ends",
    [
      {
        source: "Open https://example.org now",
        streaming: true,
        shown: [[ALL, "<span><p>Open https://example.org now</p></span>"]],
      },
      {
        source: "Open https://example.org now",
        streaming: false,
        shown: [
          [
            ALL,
            `<span><p>Open <a href="https://example.org" ${OUT}>https://example.org</a> now</p></span>`,
          ],
        ],
      },
    ],
  ],
])("renders %s as each step arrives", (_case, steps) => {
  const markdown = createStreamingMarkdown();
  const host = document.createElement("div");
  for (const { source, streaming, shown } of steps) {
    markdown.update(source, streaming);
    for (const [count, html] of shown) {
      markdown.render(host, count);
      expect(host.innerHTML, `${JSON.stringify(source)} shown to ${count}`).toBe(html);
    }
  }
});
