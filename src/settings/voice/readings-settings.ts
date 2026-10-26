export function createReadingsSettings(_opts?: unknown) {
  return { get: () => ({ text: "" }), setText(_s: string): void {} };
}
