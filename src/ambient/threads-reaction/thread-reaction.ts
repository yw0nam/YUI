/** thread-reaction — the main character's reaction to a Thread state change: a line, the Threads window, her seat on it, an expression, then the Thread's turn. */

import type { FillerPool } from "../../config/validators/filler";
import type { EmotionId, ScreenRect, ThreadsSnapshot, WindowRect } from "../../contract";
import type { AvatarExecutor } from "../../io/bridge/inbox/avatar-executor";
import type { ThreadsClient } from "../../io/threads/threads-client";
import { createShuffleBag } from "../../io/voice/filler/shuffle-bag";
import { overlaps } from "../../io/window/geometry/screen-geometry";
import type { ThreadsWindowController } from "../../io/window/openers/threads-window";
import { createLogger } from "../../logger";
import { createHeldReactions } from "./held-reactions";
import { createThreadTransitions, type ThreadTransition } from "./thread-transitions";

const log = createLogger("thread-reaction");

export interface ThreadReactionDeps {
  threads: Pick<ThreadsClient, "snapshot" | "subscribe">;
  /** The Thread reactions switch. */
  enabled: {
    get(): { enabled: boolean };
    subscribe(cb: (state: { enabled: boolean }) => void): () => void;
  };
  isPipelineBusy(): boolean;
  hasOutstandingSpeech(): boolean;
  /** Null until the stage created it. */
  getExecutor(): Pick<AvatarExecutor, "isBusy" | "command"> | null;
  /** The window she is seated on, or null. */
  armedSit(): { windowNumber: number } | null;
  threadsWindow: Pick<ThreadsWindowController, "isOpen" | "present">;
  /** The chip's slot, in this window's viewport. */
  slotRect(): ScreenRect | undefined;
  /** On-screen windows, front to back. */
  listWindows(): Promise<WindowRect[]>;
  /** Speaks a client-side line; "cut" when other speech took over. */
  speak(text: string): Promise<"spoken" | "cut">;
  lines(): Pick<FillerPool, "threads_open" | "threads_raise">;
  setEmotion(signal: { id: EmotionId }): void;
  easeEmotionToNeutral(): void;
  /** How long the expression holds before it eases back to neutral. */
  holdMs(): number;
  /** The Thread's buffered turn: held while its reaction waits or runs, fired when she finishes, released on any other end. */
  turn: {
    hold(threadId: string): void;
    fire(threadId: string): void;
    release(threadId: string): void;
  };
}

const EXPRESSION: Record<ThreadTransition["state"], EmotionId> = {
  "input-required": "curious",
  completed: "happy",
  failed: "sad",
};

const RETRY_MS = 1000;

/** Rejects a run's wait when the switch turns off or the reaction is disposed. */
const HALTED = Symbol("halted");

/** Holds the newest reacting transition per Thread and plays one at a time once she is free. */
export function createThreadReaction(deps: ThreadReactionDeps): { dispose(): void } {
  const transitions = createThreadTransitions();
  const held = createHeldReactions();
  const openBag = createShuffleBag();
  const raiseBag = createShuffleBag();
  let snapshot: ThreadsSnapshot | null = null;
  let running = false;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let revertTimer: ReturnType<typeof setTimeout> | null = null;
  // Rejects the running run's current wait.
  let halt: (() => void) | null = null;

  const enabled = (): boolean => deps.enabled.get().enabled;

  function isFree(): boolean {
    const executor = deps.getExecutor();
    return (
      executor !== null &&
      !executor.isBusy() &&
      !deps.isPipelineBusy() &&
      !deps.hasOutstandingSpeech()
    );
  }

  function clearRetry(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function stop(): void {
    for (const id of held.clear()) deps.turn.release(id);
    clearRetry();
    halt?.();
  }

  function retryLater(): void {
    retryTimer ??= setTimeout(() => {
      retryTimer = null;
      tryRun();
    }, RETRY_MS);
  }

  function tryRun(): void {
    if (disposed) return;
    if (!enabled()) {
      stop();
      return;
    }
    if (running || held.isEmpty()) return;
    if (!isFree()) {
      retryLater();
      return;
    }
    const next = held.take();
    if (next) void start(next);
  }

  async function start(reaction: ThreadTransition): Promise<void> {
    running = true;
    const halted = new Promise<never>((_, reject) => {
      halt = () => reject(HALTED);
    });
    halted.catch(() => {});
    const wait = <T>(work: Promise<T>): Promise<T> => Promise.race([work, halted]);
    let finished = false;
    try {
      finished = await perform(reaction, wait);
    } catch (error) {
      if (error !== HALTED)
        log.warn("reaction_failed", { threadId: reaction.id, error: String(error) });
    } finally {
      running = false;
      halt = null;
    }
    // A newer reaction held for the same Thread keeps its turn held and fires it after its own line.
    if (held.has(reaction.id)) tryRun();
    else if (finished) {
      deps.turn.fire(reaction.id);
      // The fired turn reaches the pipeline after this tick, so the next reaction checks on the retry.
      retryLater();
    } else {
      deps.turn.release(reaction.id);
      tryRun();
    }
  }

  async function perform(
    { id, state }: ThreadTransition,
    wait: <T>(work: Promise<T>) => Promise<T>,
  ): Promise<boolean> {
    const valid = (): boolean =>
      !disposed && enabled() && snapshot?.threads.find((t) => t.id === id)?.state === state;
    const windows = deps.threadsWindow.isOpen() ? await wait(deps.listWindows()) : null;
    if (!valid()) return false;
    const entry = windows?.find((w) => w.threadsWindow);
    const front = entry && windows ? windows.slice(0, windows.indexOf(entry)) : [];
    const where = !windows
      ? "closed"
      : !entry || front.some((w) => overlaps(w, entry))
        ? "covered"
        : "open";
    const fields = { threadId: id, state, window: where };
    log.debug("reaction_start", fields);
    if (where !== "open") {
      const pool = deps.lines();
      const line =
        where === "closed" ? openBag.draw(pool.threads_open) : raiseBag.draw(pool.threads_raise);
      if (line) {
        log.debug("reaction_line", fields);
        if ((await wait(deps.speak(line))) === "cut" || !valid()) return false;
      }
      log.debug("reaction_present", fields);
      const presented = await wait(
        where === "closed"
          ? deps.threadsWindow.present(deps.slotRect(), { thread: id })
          : deps.threadsWindow.present(),
      );
      if (presented === "closed" || !valid()) return false;
    }
    if (!entry || deps.armedSit()?.windowNumber !== entry.windowNumber) {
      const executor = deps.getExecutor();
      if (!executor) return false;
      log.debug("reaction_sit", fields);
      const result = await wait(executor.command({ action: "sit_on_window", app: "YUI" }));
      if (!("ok" in result) || !result.ok) {
        log.warn("reaction_sit.failed", { ...fields, result });
        return false;
      }
      if (!valid()) return false;
    }
    log.debug("reaction_expression", fields);
    deps.setEmotion({ id: EXPRESSION[state] });
    if (revertTimer !== null) clearTimeout(revertTimer);
    // While speech plays, its cues own the expression and its end eases it to neutral.
    revertTimer = setTimeout(() => {
      revertTimer = null;
      if (!deps.hasOutstandingSpeech()) deps.easeEmotionToNeutral();
    }, deps.holdMs());
    return true;
  }

  function onSnapshot(next: ThreadsSnapshot): void {
    snapshot = next;
    for (const t of transitions.next(next)) {
      held.hold(t);
      deps.turn.hold(t.id);
    }
    for (const id of held.prune(next)) deps.turn.release(id);
    tryRun();
  }

  const seeded = deps.threads.snapshot();
  if (seeded) onSnapshot(seeded);
  const offSnapshot = deps.threads.subscribe(onSnapshot);
  const offEnabled = deps.enabled.subscribe(() => tryRun());

  return {
    dispose() {
      disposed = true;
      offSnapshot();
      offEnabled();
      stop();
      if (revertTimer !== null) clearTimeout(revertTimer);
    },
  };
}
