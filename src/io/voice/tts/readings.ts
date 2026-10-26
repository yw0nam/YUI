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

/** The dictionary of `getText()`, rebuilt only when the text changes; `apply` is one left-to-right pass, so a reading is never replaced again. */
export function createReadings(getText: () => string): {
  apply(text: string): string;
  text(): string;
} {
  let source: string | undefined;
  let lookup = new Map<string, string>();
  let pattern: RegExp | undefined;
  const current = (): string => {
    const text = getText();
    if (text !== source) {
      source = text;
      const pairs: ReadingPair[] = parseReadings(text).pairs;
      lookup = new Map(pairs);
      pattern =
        pairs.length === 0
          ? undefined
          : new RegExp(pairs.map(([s]) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    }
    return text;
  };
  return {
    text: current,
    apply(text) {
      current();
      return pattern ? text.replace(pattern, (m) => lookup.get(m) ?? m) : text;
    },
  };
}
