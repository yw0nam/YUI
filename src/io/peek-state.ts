import { createLogger } from "../logger";

const log = createLogger("peek-state");

export interface PeekStateDeps {
  getWindow: () => {
    setAlwaysOnTop(value: boolean): Promise<void>;
    setAlwaysOnBottom(value: boolean): Promise<void>;
  };
  hitTest: {
    suspend(mode?: "capture" | "passthrough", owner?: string): void;
    resume(owner?: string): void;
  };
}

export interface PeekState {
  enter(): Promise<void>;
  exit(): Promise<void>;
  active(): boolean;
  dispose(): Promise<void>;
}

export function createPeekState(deps: PeekStateDeps): PeekState {
  let activeIntent = false;
  let dirty = false;
  let chain = Promise.resolve();

  async function attempt(name: string, operation: () => void | Promise<void>): Promise<boolean> {
    try {
      await operation();
      return true;
    } catch (err) {
      log.warn("peek_state_operation_failed", { operation: name, error: String(err) });
      return false;
    }
  }

  function enqueue(operation: () => Promise<void>): Promise<void> {
    chain = chain.then(operation, operation).catch((err: unknown) => {
      log.warn("peek_state_sequence_failed", { error: String(err) });
    });
    return chain;
  }

  function enter(): Promise<void> {
    if (activeIntent) return chain;
    activeIntent = true;
    return enqueue(async () => {
      await attempt("suspend_passthrough", () => deps.hitTest.suspend("passthrough", "peek"));
      await attempt("always_on_top_false", () => deps.getWindow().setAlwaysOnTop(false));
      await attempt("always_on_bottom_true", () => deps.getWindow().setAlwaysOnBottom(true));
    });
  }

  function exit(): Promise<void> {
    if (!activeIntent && !dirty) return chain;
    activeIntent = false;
    return enqueue(async () => {
      const bottom = await attempt("always_on_bottom_false", () =>
        deps.getWindow().setAlwaysOnBottom(false),
      );
      const top = await attempt("always_on_top_true", () => deps.getWindow().setAlwaysOnTop(true));
      const resumed = await attempt("hit_test_resume", () => deps.hitTest.resume("peek"));
      dirty = !(bottom && top && resumed);
    });
  }

  return {
    enter,
    exit,
    active: () => activeIntent,
    dispose: exit,
  };
}
