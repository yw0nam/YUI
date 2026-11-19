/** Stub for the red run: the store answers nothing yet. */

import type { Span } from "./spans";

export function createActiveHoursSettings(_opts?: unknown): {
  get(): { spans: Span[] | null };
  setSpans(spans: Span[]): void;
  reset(): void;
  reloadFromStorage(): void;
  subscribe(cb: (s: { spans: Span[] | null }) => void): () => void;
  dispose(): void;
} {
  return {
    get: () => undefined as unknown as { spans: Span[] | null },
    setSpans: () => {},
    reset: () => {},
    reloadFromStorage: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
}
