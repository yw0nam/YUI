/** The Threads panel's edge and corner hit areas. */

export interface ResizeListener {
  start(): void;
  move(edge: string, dx: number, dy: number): void;
  end(): void;
}

export function attachResizeHandles(_deps: {
  panel: HTMLElement;
  listener: ResizeListener;
}): () => void {
  return () => {};
}
