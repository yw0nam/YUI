/** thread-reaction — the main character's Thread reaction: started by a chip tap, the waiting count, or a long wait; a line, the Threads window, her seat on it, an expression, then every held Thread turn. */

import type { FillerPool } from "../../config/validators/filler";
import type {
  EmotionId,
  ScreenRect,
  Thread,
  ThreadsSnapshot,
  WindowRect,
} from "../../contract";
import type { AvatarExecutor } from "../../io/bridge/inbox/avatar-executor";
import type { ThreadsClient } from "../../io/threads/threads-client";
import { isUnseenWaiting } from "../../io/threads/threads-waiting";
import { createShuffleBag } from "../../io/voice/filler/shuffle-bag";
import { overlaps } from "../../io/window/geometry/screen-geometry";
import type { ThreadsWindowController } from "../../io/window/openers/threads-window";
import { createLogger } from "../../logger";
import { prefersReducedMotion } from "../liveliness/tier1";
import { createReactionThresholds } from "./reaction-thresholds";

const log = createLogger("thread-reaction");

export type ReactionCause = "tap" | "count" | "wait";

export interface ThreadReactionDeps {
  threads: Pick<ThreadsClient, "snapshot" | "subscribe">;
  /** The Thread reactions switch. */
  enabled: {
    get(): { enabled: boolean };
    subscribe(cb: (state: { enabled: boolean }) => void): () => void;
  };
  /** The Reaction thresholds: the waiting count and wait that start a reaction without a tap. */
  thresholds: {
    get(): { count: number; wait_min: number };
    subscribe(cb: () => void): () => void;
  };
  /** Whether the user is at the machine; a count or wait reaction waits for it, a tap does not. */
  isPresent(): boolean;
  /** Subscribes to Threads-chip taps; the chip has already opened the window, so a tap plays no line. */
  chipTaps(cb: () => void): () => void;
  isPipelineBusy(): boolean;
  hasOutstandingSpeech(): boolean;
  /** Null until the stage created it. */
  getExecutor(): Pick<AvatarExecutor, "isBusy" | "command"> | null;
  /** The window she is seated on, or null. */
  armedSit(): { windowNumber: number } | null;
  threadsWindow: Pick<ThreadsWindowController, "isOpen" | "present" | "onShown">;
  /** The chip's slot, in this window's viewport. */
  slotRect(): ScreenRect | undefined;
  /** On-screen windows, front to back. */
  listWindows(): Promise<WindowRect[]>;
  /** Speaks a client-side line; "cut" when other speech took over. */
  speak(text: string): Promise<"spoken" | "cut">;
  lines(): Pick<FillerPool, "threads_open" | "threads_raise">;
  setEmotion(signal: { id: EmotionId }): void;
  /** Her landing bounce after a sit; resolves when it ends. */
  land(): Promise<void>;
  easeEmotionToNeutral(): void;
  /** How long the expression holds before it eases back to neutral. */
  holdMs(): number;
  /** The snapshot Threads' buffered turns: held while the switch is on, fired together when a reaction finishes, released when their Thread leaves or the switch goes off. */
  turn: {
    hold(threadId: string): void;
    release(threadId: string): void;
    fire(threadIds: string[]): void;
  };
}

/** What the next reaction runs for; one slot, the newest cause winning. */
type PendingReaction = { cause: "tap" } | { cause: "count" } | { cause: "wait"; threadId: string };

type RunResult = "done" | "stopped" | "not-ready";

const RETRY_MS = 1000;

/** Rejects a run's wait when the switch turns off or the reaction is disposed. */
const HALTED = Symbol("halted");

export function createThreadReaction(deps: ThreadReactionDeps): { dispose(): void } {
  const openBag = createShuffleBag();
  const raiseBag = createShuffleBag();
  const thresholds = createReactionThresholds({
    count: () => deps.thresholds.get().count,
    waitMs: () => deps.thresholds.get().wait_min * 60_000,
    now: () => Date.now(),
    onReach: (cause) => {
      if (!enabled()) return;
      setPending(cause);
      tryRun();
    },
  });
  let snapshot: ThreadsSnapshot | null = null;
  /** The waiting unseen Threads, newest first — the count's present target and a wait's validity. */
  let counted: Thread[] = [];
  /** The snapshot's Thread ids whose turn stays held while the switch is on. */
  const held = new Set<string>();
  let pending: PendingReaction | null = null;
  let runningCause: PendingReaction | null = null;
  let running = false;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let revertTimer: ReturnType<typeof setTimeout> | null = null;
  // Rejects the running run's current wait.
  let halt: (() => void) | null = null;
  // Set when the Threads window closes under the running tap.
  let cancelled = false;

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
    for (const id of held) deps.turn.release(id);
    held.clear();
    pending = null;
    clearRetry();
    halt?.();
  }

  function retryLater(): void {
    retryTimer ??= setTimeout(() => {
      retryTimer = null;
      tryRun();
    }, RETRY_MS);
  }

  function setPending(cause: PendingReaction): void {
    // A tap replaces any pending cause; a count or wait never replaces a tap.
    if (cause.cause !== "tap" && pending?.cause === "tap") return;
    pending = cause;
  }

  function tryRun(): void {
    if (disposed) return;
    if (!enabled()) {
      stop();
      return;
    }
    if (running || pending === null) return;
    // A count or wait also waits for the user's return; a tap does not.
    if (pending.cause !== "tap" && !deps.isPresent()) {
      retryLater();
      return;
    }
    if (!isFree()) {
      retryLater();
      return;
    }
    const next = pending;
    pending = null;
    void start(next);
  }

  async function start(cause: PendingReaction): Promise<void> {
    running = true;
    runningCause = cause;
    cancelled = false;
    const halted = new Promise<never>((_, reject) => {
      halt = () => reject(HALTED);
    });
    halted.catch(() => {});
    const wait = <T>(work: Promise<T>): Promise<T> => Promise.race([work, halted]);
    let finished: RunResult = "stopped";
    try {
      finished = await perform(cause, wait);
    } catch (error) {
      if (error !== HALTED)
        log.warn("reaction_failed", {
          cause: cause.cause,
          threadId: cause.cause === "wait" ? cause.threadId : undefined,
          error: String(error),
        });
    } finally {
      running = false;
      runningCause = null;
      halt = null;
    }
    if (finished === "done") {
      if (held.size > 0) deps.turn.fire([...held]);
      // The fired turn reaches the pipeline after this tick, so the next reaction checks on the retry.
      retryLater();
    } else if (finished === "not-ready") {
      // The chip's open is still in flight; the tap goes back to the slot for the retry.
      if (pending?.cause !== "tap") pending = cause;
      retryLater();
    } else {
      tryRun();
    }
  }

  async function sitOn(
    entry: WindowRect | undefined,
    fields: Record<string, unknown>,
    valid: () => boolean,
    wait: <T>(work: Promise<T>) => Promise<T>,
  ): Promise<RunResult> {
    if (!entry || deps.armedSit()?.windowNumber !== entry.windowNumber) {
      const executor = deps.getExecutor();
      if (!executor) return "stopped";
      log.debug("reaction_sit", fields);
      const result = await wait(executor.command({ action: "sit_on_window", app: "YUI" }));
      if (!("ok" in result) || !result.ok) {
        log.warn("reaction_sit.failed", { ...fields, result });
        return "stopped";
      }
      if (!prefersReducedMotion()) {
        log.debug("reaction_land", fields);
        await wait(deps.land());
      }
      if (!valid()) return "stopped";
    }
    return "done";
  }

  function express(fields: Record<string, unknown>): void {
    log.debug("reaction_expression", fields);
    deps.setEmotion({ id: "curious" });
    if (revertTimer !== null) clearTimeout(revertTimer);
    // While speech plays, its cues own the expression and its end eases it to neutral.
    revertTimer = setTimeout(() => {
      revertTimer = null;
      if (!deps.hasOutstandingSpeech()) deps.easeEmotionToNeutral();
    }, deps.holdMs());
  }

  async function perform(
    cause: PendingReaction,
    wait: <T>(work: Promise<T>) => Promise<T>,
  ): Promise<RunResult> {
    const valid = (): boolean => {
      if (disposed || !enabled()) return false;
      if (cause.cause === "tap") return !cancelled;
      if (cause.cause === "wait") return counted.some((thread) => thread.id === cause.threadId);
      return counted.length > 0;
    };
    if (cause.cause === "tap") {
      const windows = await wait(deps.listWindows());
      if (!valid()) return "stopped";
      const entry = windows.find((w) => w.threadsWindow);
      // The chip's open is still in flight: isOpen turns true before the window is on screen.
      if (!entry) return "not-ready";
      const fields = { cause: cause.cause, window: "open" as const };
      log.debug("reaction_start", fields);
      if ((await sitOn(entry, fields, valid, wait)) === "stopped") return "stopped";
      express(fields);
      return "done";
    }
    const windows = deps.threadsWindow.isOpen() ? await wait(deps.listWindows()) : null;
    if (!valid()) return "stopped";
    const entry = windows?.find((w) => w.threadsWindow);
    const front = entry && windows ? windows.slice(0, windows.indexOf(entry)) : [];
    const where = !windows
      ? "closed"
      : !entry || front.some((w) => overlaps(w, entry))
        ? "covered"
        : "open";
    const fields: Record<string, unknown> = { cause: cause.cause, window: where };
    if (cause.cause === "wait") fields.threadId = cause.threadId;
    log.debug("reaction_start", fields);
    if (where !== "open") {
      const pool = deps.lines();
      const line =
        where === "closed" ? openBag.draw(pool.threads_open) : raiseBag.draw(pool.threads_raise);
      if (line) {
        log.debug("reaction_line", fields);
        if ((await wait(deps.speak(line))) === "cut" || !valid()) return "stopped";
      }
      log.debug("reaction_present", fields);
      const thread = cause.cause === "wait" ? cause.threadId : counted[0]?.id;
      const presented = await wait(
        where === "closed"
          ? deps.threadsWindow.present(deps.slotRect(), thread ? { thread } : undefined)
          : deps.threadsWindow.present(),
      );
      if (presented === "closed" || !valid()) return "stopped";
    }
    if ((await sitOn(entry, fields, valid, wait)) === "stopped") return "stopped";
    express(fields);
    return "done";
  }

  function holdSnapshot(next: ThreadsSnapshot): void {
    for (const thread of next.threads) {
      if (held.has(thread.id)) continue;
      held.add(thread.id);
      deps.turn.hold(thread.id);
    }
    for (const id of [...held]) {
      if (next.threads.some((thread) => thread.id === id)) continue;
      held.delete(id);
      deps.turn.release(id);
    }
  }

  function onSnapshot(next: ThreadsSnapshot): void {
    snapshot = next;
    counted = next.threads.filter(isUnseenWaiting).sort((a, b) => b.updated_at - a.updated_at);
    if (enabled()) holdSnapshot(next);
    thresholds.next(counted);
    const waitPending = pending?.cause === "wait" ? pending : null;
    if (waitPending && !counted.some((thread) => thread.id === waitPending.threadId))
      pending = null;
    tryRun();
  }

  const seeded = deps.threads.snapshot();
  if (seeded) onSnapshot(seeded);
  const offSnapshot = deps.threads.subscribe(onSnapshot);
  const offEnabled = deps.enabled.subscribe(() => {
    if (enabled() && snapshot) holdSnapshot(snapshot);
    tryRun();
  });
  const offShown = deps.threadsWindow.onShown((shown) => {
    if (shown) return;
    // The window closed under a tap: drop the pending one and stop the running one.
    if (pending?.cause === "tap") pending = null;
    if (runningCause?.cause === "tap") {
      cancelled = true;
      halt?.();
    }
  });
  const offTaps = deps.chipTaps(() => {
    if (!enabled()) return;
    pending = { cause: "tap" };
    tryRun();
  });
  const offThresholds = deps.thresholds.subscribe(() => thresholds.recheck());

  return {
    dispose() {
      disposed = true;
      offSnapshot();
      offEnabled();
      offShown();
      offTaps();
      offThresholds();
      thresholds.dispose();
      stop();
      if (revertTimer !== null) clearTimeout(revertTimer);
    },
  };
}
