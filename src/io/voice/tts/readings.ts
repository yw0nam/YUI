export function parseReadings(_text: string): {
  pairs: Array<[surface: string, reading: string]>;
  skipped: number[];
} {
  return { pairs: [], skipped: [] };
}

export function applyReadings(text: string, _pairs: Array<[string, string]>): string {
  return text;
}
