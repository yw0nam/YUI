/**
 * devtools-main.test-helpers.ts — mock factories shared by the devtools-main.*.test.ts files.
 *
 * Each test file still declares its own vi.mock/vi.hoisted calls (hoisting is per-file), but the
 * factory bodies they build from live here. A vi.hoisted() factory runs before this file's own
 * import would resolve, so callers pull these in via a dynamic import() inside an async
 * vi.hoisted(async () => { const { ... } = await import("./devtools-main.test-helpers"); ... }).
 */

import { vi } from "vitest";

/** info/warn/error/debug spies mirroring the real Logger shape. */
export function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** wireDevtoolsSync + createConfigStore + initLogger + createLogger mocks every devtools-main test needs. */
export function makeDevtoolsMainMocks() {
  const log = makeLog();
  return {
    wireDevtoolsSync: vi.fn(() => ({ reload: vi.fn(), dispose: vi.fn() })),
    createConfigStore: vi.fn(() => ({
      load: vi.fn().mockResolvedValue({ endpoints: { chat_model_context_window: 1 } }),
    })),
    initLogger: vi.fn().mockResolvedValue(undefined),
    createLogger: vi.fn(() => log),
    log,
  };
}

/** Tears down the devtools-main module state a test bootstrapped via `await import("./devtools-main")`. */
export function resetDevtoolsMain(): void {
  window.dispatchEvent(new Event("beforeunload"));
}
