/**
 * Config store — layers a reactive snapshot + hot-reload on top of loadConfig.
 *
 * Responsibilities:
 *  - After the first load(), holds the validated AppConfig snapshot → get().
 *  - subscribe(fn): on config change, notifies (new config, set of changed sections). Hot-swap
 *    targets like VRM/motion/proactivity are handled by subscribers (e.g. main.ts re-calls renderer.loadVRM on avatar change).
 *  - Hot-reload: start(intervalMs) → periodically re-fetch/re-validate → detect per-section changes → notify.
 *    An invalid edit (ConfigError) **keeps the current config** and only notifies via onError → an editing mistake
 *    does not break the running app.
 *
 * Sensitive-value (API key) policy: SecretProvider is re-bound on reload, but runtime swap of an
 * already-created client is not forced — the new value takes effect **from the next call**.
 *
 * File-watching approach: zero-dependency **polling** (re-fetch + per-section serialized compare). Works on both
 * dev (vite static serving) and Tauri webview without extra plugins. Swappable for Tauri fs-watch —
 * leave the subscribe/snapshot contract as is and just change the trigger.
 */

import {
  type AppConfig,
  type ConfigSection,
  type LoadConfigOptions,
  loadConfig,
  type SecretProvider,
} from "./load";

/** Default polling interval (ms). Too frequent wastes fetches, too slow delays edit propagation. */
const DEFAULT_POLL_MS = 1500;

export type ConfigListener = (config: AppConfig, changed: ReadonlySet<ConfigSection>) => void;
export type ConfigErrorListener = (err: unknown) => void;

export interface ConfigStore {
  /** Loads once. get() becomes valid afterward. Throws on failure (handled at bootstrap). */
  load(): Promise<AppConfig>;
  /** Current snapshot. Throws if called before load(). */
  get(): AppConfig;
  /** Notifies the diff after re-fetch/re-validate. Preserves the current snapshot and returns false even on failure. */
  reload(): Promise<boolean>;
  /** Subscribe to changes. Does not notify once immediately (use get() for the current value). Returns unsubscribe. */
  subscribe(fn: ConfigListener): () => void;
  /** Start hot-reload polling (ignores duplicate calls). */
  start(intervalMs?: number): void;
  /** Stop polling. */
  stop(): void;
  /** Receives ConfigError etc. raised during reload (polling never throws). */
  onError(fn: ConfigErrorListener): () => void;
  /** Secret lookup (api_key etc.). Provider injected at load time. */
  readonly secrets: SecretProvider;
}

export interface ConfigStoreOptions extends LoadConfigOptions {
  /** Secret lookup for api keys etc. — empty plainSecretProvider when unspecified. */
  secrets?: SecretProvider;
}

/** Set of sections that changed between two AppConfigs. section = AppConfig's keys, so iterate keys instead of a hardcoded list (avoids drift). */
function diffSections(a: AppConfig, b: AppConfig): Set<ConfigSection> {
  const changed = new Set<ConfigSection>();
  for (const s of Object.keys(b) as ConfigSection[]) {
    if (JSON.stringify(a[s]) !== JSON.stringify(b[s])) changed.add(s);
  }
  return changed;
}

export function createConfigStore(opts: ConfigStoreOptions = {}): ConfigStore {
  const { secrets: secretsOpt, ...loadOpts } = opts;
  const secrets: SecretProvider = secretsOpt ?? {
    async get() {
      return undefined;
    },
  };

  let current: AppConfig | null = null;
  const listeners = new Set<ConfigListener>();
  const errorListeners = new Set<ConfigErrorListener>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false; // guard against re-entry (previous reload not yet done)

  // Hot-reload re-fetch must bypass the cache every time (browser/webview HTTP cache).
  function bustOpts(): LoadConfigOptions {
    // Date.now() is allowed in the app runtime. With an injected reader (tests), cacheBust is ignored.
    return { ...loadOpts, cacheBust: String(Date.now()) };
  }

  // ⚠ Never rejects (errors flow to onError and false is returned). start()'s polling re-entry
  //   guard (polling flag + .finally) depends on this invariant.
  async function reload(): Promise<boolean> {
    let next: AppConfig;
    try {
      next = await loadConfig(current ? bustOpts() : loadOpts);
    } catch (err) {
      for (const fn of errorListeners) fn(err);
      return false;
    }
    if (current === null) {
      current = next;
      return true;
    }
    const changed = diffSections(current, next);
    if (changed.size === 0) return false;
    current = next;
    for (const fn of listeners) fn(next, changed);
    return true;
  }

  return {
    async load() {
      current = await loadConfig(loadOpts);
      return current;
    },
    get() {
      if (current === null) {
        throw new Error("[config] store.get() before load() — load()를 먼저 await 하라");
      }
      return current;
    },
    reload,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onError(fn) {
      errorListeners.add(fn);
      return () => errorListeners.delete(fn);
    },
    start(intervalMs = DEFAULT_POLL_MS) {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (polling) return;
        polling = true;
        void reload().finally(() => {
          polling = false;
        });
      }, intervalMs);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    secrets,
  };
}
