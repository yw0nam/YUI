/** A Thread's source as the chip, the list, and the pane draw it: a name and a one-glyph mark. */

const KNOWN = new Map<string, { name: string; mark: string }>([
  ["claude-code", { name: "Claude Code", mark: "✳" }],
  ["codex", { name: "Codex", mark: "C" }],
  ["github-ci", { name: "GitHub CI", mark: "⑂" }],
  ["slack", { name: "Slack", mark: "#" }],
  ["gmail", { name: "Gmail", mark: "@" }],
  ["notion", { name: "Notion", mark: "N" }],
]);

/** A source outside the table shows its raw text and the generic mark. */
export function threadSource(source: string): { name: string; mark: string } {
  return KNOWN.get(source) ?? { name: source, mark: "•" };
}
