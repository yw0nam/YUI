/** last-emotion — the last emotion a backend cue carried in this window, in memory only. */

let last: { id: string; atMs: number } | null = null;

/** The last emotion id a backend cue carried, and when (ms). Client-chosen emotions never land here. */
export function recordBackendEmotion(id: string, atMs: number): void {
  // Backend output is untrusted: only a non-empty string id is a record.
  if (typeof id !== "string" || id === "") return;
  last = { id, atMs };
}

/** The recorded id, or "neutral" when nothing is recorded or the record is older than decayMs. */
export function lastBackendEmotion(nowMs: number, decayMs: number): string {
  return last && nowMs - last.atMs <= decayMs ? last.id : "neutral";
}
