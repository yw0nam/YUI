/**
 * Android back-button claim — the one open surface that should swallow the system back gesture
 * holds the claim; with it released, back keeps its platform default. Registration is serialized:
 * a release landing during a pending registration unregisters as soon as it resolves, a claim
 * landing during a pending release waits for it, and a rejected registration is logged while the
 * surface stays closable by its own controls.
 */

// biome-ignore lint/style/noRestrictedImports: external package, not a src layer
import { onBackButtonPress } from "@tauri-apps/api/app";
import { createLogger, type Logger } from "../../logger";
import { isTauri } from "../../tauri-env";

export type BackButtonRegister = (cb: () => void) => Promise<() => void | Promise<void>>;

/** The platform register — the App plugin's back listener, or nothing outside Tauri. */
function registerBackButton(cb: () => void): Promise<() => void> {
  if (!isTauri()) return Promise.resolve(() => {});
  return onBackButtonPress(cb).then((listener) => () => listener.unregister());
}

export interface BackButtonClaim {
  /** Route the back gesture to handler while claimed (suppresses the platform default). */
  claim(handler: () => void): void;
  /** Give the gesture back to the platform default. */
  release(): void;
  /** Release permanently. */
  dispose(): void;
}

export function createBackButtonClaim(
  register: BackButtonRegister = registerBackButton,
  log: Logger = createLogger("back-button"),
): BackButtonClaim {
  let handler: (() => void) | null = null;
  let unlisten: (() => void) | null = null;
  let settle: Promise<void> = Promise.resolve();

  const emit = (): void => handler?.();

  // Settle one queued transition into place: registered while claimed, unregistered otherwise.
  // `want` is captured when the transition is queued, so each step applies exactly the state its
  // caller asked for, in order.
  const apply = (want: (() => void) | null): Promise<void> => {
    if (want !== null && unlisten === null) {
      return register(emit).then(
        (u) => {
          unlisten = u;
        },
        (error) => {
          log.warn("back_button_register_failed", { error: String(error) });
        },
      );
    }
    if (want === null && unlisten !== null) {
      const u = unlisten;
      unlisten = null;
      return Promise.resolve(u()).then(
        () => undefined,
        (error: unknown) => {
          log.warn("back_button_unregister_failed", { error: String(error) });
        },
      );
    }
    return Promise.resolve();
  };

  const sync = (): void => {
    const want = handler;
    settle = settle.then(
      () => apply(want),
      () => apply(want),
    );
  };

  return {
    claim(h) {
      handler = h;
      sync();
    },
    release() {
      handler = null;
      sync();
    },
    dispose() {
      handler = null;
      sync();
    },
  };
}
