export type ReadingPair = [surface: string, reading: string];

/** One `surface=reading` pair per line; later duplicates win, longest surface first, bad lines numbered in `skipped`. */
export function parseReadings(text: string): { pairs: ReadingPair[]; skipped: number[] } {
  const map = new Map<string, string>();
  const skipped: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    const eq = line.indexOf("=");
    const surface = eq < 0 ? "" : line.slice(0, eq).trim();
    const reading = eq < 0 ? "" : line.slice(eq + 1).trim();
    if (surface === "" || reading === "") skipped.push(i + 1);
    else map.set(surface, reading);
  });
  return { pairs: [...map].sort((a, b) => b[0].length - a[0].length), skipped };
}

/** One left-to-right pass, so a reading is never replaced again. */
export function applyReadings(text: string, pairs: readonly ReadingPair[]): string {
  if (pairs.length === 0) return text;
  const lookup = new Map(pairs);
  const alternation = pairs.map(([s]) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(alternation, "g"), (m) => lookup.get(m) ?? m);
}
