/** The last emotion id a backend cue carried, and when (ms). Client-chosen emotions never land here. */
export function recordBackendEmotion(_id: string, _atMs: number): void {}

/** The recorded id, or "neutral" when nothing is recorded or the record is older than decayMs. */
export function lastBackendEmotion(_nowMs: number, _decayMs: number): string {
  return "";
}
