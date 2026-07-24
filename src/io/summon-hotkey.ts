/**
 * Global summon hotkey — registers the configs/hotkeys.json accelerator as an OS-wide
 * shortcut and, when fired, brings the window forward and summons the input.
 *
 * fail-soft: if register is rejected (invalid accelerator / OS already holds it), warn and
 * stay inactive — never break boot/hot-reload. Register/unregister APIs are injected
 * (non-Tauri/tests) so this isn't bound to the runtime.
 */

import { createLogger } from "../logger";

const log = createLogger("summon-hotkey");

/** Plugin shortcut event handler — state "Pressed" | "Released". */
export type SummonHotkeyTrigger = (event: { state: string }) => void;

interface SummonHotkeyDeps {
  register(accelerator: string, handler: SummonHotkeyTrigger): Promise<void>;
  unregister(accelerator: string): Promise<void>;
  /** Bring the window forward + focus (including activating the app from the background). */
  focusWindow(): Promise<void>;
  summonInput(): void;
  /** Whether the input is already open — if so, don't re-summon (just bring the window forward). */
  isInputOpen(): boolean;
}

export interface SummonHotkey {
  /** Apply an accelerator: unregister the existing one, then re-register. Empty string = inactive. Never rejects. */
  apply(accelerator: string): Promise<void>;
  /** Currently registered accelerator. null when inactive. */
  current(): string | null;
  /** Unregister (teardown/HMR). */
  dispose(): Promise<void>;
}

export function createSummonHotkey(deps: SummonHotkeyDeps): SummonHotkey {
  let registered: string | null = null;
  // Serialize apply — keeps hot-reload key mashing from overlapping register/unregister.
  let chain: Promise<void> = Promise.resolve();
  // Only one focus+summon cycle at a time. summonInput's is-open class is attached after an rAF,
  // so isInputOpen() lags by one frame; drop repeats (key repeat) arriving mid-cycle to prevent
  // double summons.
  // ponytail: the ~16ms residual window between finally and rAF is unreachable by human mashing, so leave it.
  let inFlight = false;

  function onTrigger(event: { state: string }): void {
    if (event.state !== "Pressed") return;
    if (inFlight) return;
    inFlight = true;
    // Even re-firing from another app always brings the window forward. Summon only when the
    // input is closed — so key repeat/re-fire doesn't reset the open animation or error display
    // (same as the local "/" guard).
    void deps
      .focusWindow()
      .catch((err) => log.warn("focus_failed", { error: String(err) }))
      .then(() => {
        if (!deps.isInputOpen()) deps.summonInput();
      })
      .finally(() => {
        inFlight = false;
      });
  }

  async function applyNow(accelerator: string): Promise<void> {
    if (accelerator === (registered ?? "")) return;
    if (registered !== null) {
      try {
        await deps.unregister(registered);
      } catch (err) {
        log.warn("unregister_failed", { accelerator: registered, error: String(err) });
      }
      registered = null;
    }
    if (accelerator === "") {
      log.info("disabled", { reason: "empty_accelerator" });
      return;
    }
    try {
      await deps.register(accelerator, onTrigger);
      registered = accelerator;
      log.info("registered", { accelerator });
    } catch (err) {
      // Invalid accelerator or held by the OS/another app — stay inactive (fail-soft).
      log.warn("register_failed", { accelerator, error: String(err) });
    }
  }

  return {
    apply(accelerator) {
      chain = chain.then(() => applyNow(accelerator));
      return chain;
    },
    current: () => registered,
    dispose() {
      chain = chain.then(() => applyNow(""));
      return chain;
    },
  };
}
