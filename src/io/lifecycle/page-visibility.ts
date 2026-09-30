/**
 * Page visibility as a suspension port — hidden means the webview is gone (Home, screen lock,
 * app switch) and nothing background should run. Created before any async setup so the initial
 * state is read synchronously at startup.
 */

export interface PageVisibility {
  /** True while the page is hidden. */
  get(): boolean;
  subscribe(cb: () => void): () => void;
  /** Detaches the document listener; the port is dead afterwards. */
  dispose(): void;
}

export function watchPageVisibility(
  doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
): PageVisibility {
  const listeners = new Set<() => void>();
  const onChange = (): void => {
    for (const cb of [...listeners]) cb();
  };
  doc.addEventListener("visibilitychange", onChange);
  return {
    get: () => doc.visibilityState === "hidden",
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    dispose(): void {
      doc.removeEventListener("visibilitychange", onChange);
    },
  };
}
