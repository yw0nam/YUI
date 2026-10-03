/**
 * Textarea round-trip for the filler pool's `tool` tier: one phrase per line, either plain
 * (goes to `_default`) or `tool_id = phrase` (targets that tool_id).
 */

const TOOL_KEY_RE = /^[A-Za-z0-9_.:-]+$/;

/** Parses the tool textarea's text into a `tool` tier. Blank lines are skipped. */
export function parseToolLines(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq >= 0) {
      const key = line.slice(0, eq).trim();
      if (TOOL_KEY_RE.test(key)) {
        const phrase = line.slice(eq + 1).trim();
        if (phrase) (out[key] ??= []).push(phrase);
        continue;
      }
    }
    (out._default ??= []).push(line);
  }
  return out;
}

/** Serializes a `tool` tier back to textarea text — `_default` lines first, then `key = phrase` sorted by key. */
export function serializeToolLines(tool: Record<string, string[]>): string {
  const lines: string[] = [...(tool._default ?? [])];
  for (const key of Object.keys(tool)
    .filter((k) => k !== "_default")
    .sort()) {
    for (const phrase of tool[key]!) lines.push(`${key} = ${phrase}`);
  }
  return lines.join("\n");
}
