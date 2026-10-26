/** The character's name as the pet window last sent it to the message window. */

export interface MirroredName {
  get(): string;
  set(name: string): void;
  subscribe(cb: () => void): () => void;
}

export function createMirroredName(): MirroredName {
  let name = "";
  const listeners = new Set<() => void>();
  return {
    get: () => name,
    set(next) {
      name = next;
      for (const cb of listeners) cb();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
