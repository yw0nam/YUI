import type { UnifiedShown } from "../../settings/unified/unified-shown";

/** Main opens the unified chat window while it is shown, and closes it otherwise. */
export function wireUnifiedWindow(deps: {
  shown: UnifiedShown;
  window: { open(): void; close(): void };
}): () => void {
  const apply = (shown: boolean): void => {
    if (shown) deps.window.open();
    else deps.window.close();
  };
  apply(deps.shown.get());
  return deps.shown.subscribe(apply);
}
