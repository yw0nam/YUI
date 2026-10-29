// Every page the docs site builds holds at most 60 words in a paragraph, list item, or table
// cell, and at most 250 words of prose (paragraphs and list items, not table cells) between
// headings. Frontmatter and fenced code are not prose. Exits 1 with one line per breach.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The pages VitePress does not build (`docs/.vitepress/config.ts` `srcExclude`), and the agent
// instruction set written in ASD-STE100.
const isPage = (p) =>
  !p.startsWith("docs/agent-guide/") &&
  !p.startsWith("docs/agents/") &&
  p !== "docs/guide/install.md";

// Arguments name files to check; with none, every page under `docs/` is checked.
const pages = process.argv.slice(2);
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".md") && isPage(p)) pages.push(p);
  }
};
if (!pages.length) walk("docs");
pages.sort();

const words = (text) => text.split(/\s+/).filter(Boolean).length;

const breaches = [];
const preview = (text) => text.trim().replace(/\s+/g, " ").slice(0, 70);

const audit = (file) => {
  const text = readFileSync(file, "utf8")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
  let stretch = 0;
  let heading = "(top)";
  const block = (kind, chunk) => {
    const n = words(chunk);
    if (n > 60) breaches.push(`${file}: ${kind} ${n} words under ${heading}: "${preview(chunk)}"`);
    if (kind !== "table cell") stretch += n;
  };
  const close = () => {
    if (stretch > 250) breaches.push(`${file}: stretch ${stretch} words under ${heading}`);
  };
  for (const para of text.split(/\n\s*\n/)) {
    let lines = para
      .trim()
      .split(/\r\n|\r|\n/)
      .filter((l) => !l.startsWith(":::"));
    if (!lines.length) continue;
    if (/^#{1,6} /.test(lines[0])) {
      close();
      stretch = 0;
      heading = lines[0];
      lines = lines.slice(1);
      if (!lines.length) continue;
    }
    if (lines[0].startsWith("|")) {
      for (const line of lines) {
        if (/^\|\s*:?-/.test(line)) continue;
        const cells = line.trim().replace(/^\|+/, "").replace(/\|+$/, "").split("|");
        for (const cell of cells) block("table cell", cell);
      }
    } else if (/^\s*(?:[-*]|\d+\.) /.test(lines[0])) {
      for (const item of `\n${lines.join("\n")}`.split(/\n\s*(?:[-*]|\d+\.) /)) {
        if (item.trim()) block("list item", item);
      }
    } else {
      block("paragraph", lines.join("\n"));
    }
  }
  close();
};

for (const page of pages) audit(page);

if (breaches.length) {
  console.error(
    `a page breaks the readability rule (${breaches.length} in ${pages.length} pages):\n${breaches.join("\n")}`,
  );
  process.exit(1);
}
