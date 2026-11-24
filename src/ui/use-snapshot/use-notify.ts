import { useSnapshot } from "./use-snapshot";

const fresh = (): object => ({});
const none = (): (() => void) => () => {};

/**
 * Re-renders the component on each notify of a source it reads itself; no source, never. The token
 * it returns is the same object until the next notify.
 */
export function useNotify(subscribe?: (cb: () => void) => () => void): object {
  return useSnapshot(fresh, subscribe ?? none);
}
