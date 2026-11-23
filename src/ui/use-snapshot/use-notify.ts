import { useSnapshot } from "./use-snapshot";

const fresh = (): object => ({});
const none = (): (() => void) => () => {};

/** Re-renders the component on each notify of a source it reads itself; no source, never. */
export function useNotify(subscribe?: (cb: () => void) => () => void): void {
  useSnapshot(fresh, subscribe ?? none);
}
