/** Idle-gap watchdog over a backend event stream, with its two timeout budgets. */

/**
 * Idle-gap watchdog deadline (ms) applied whenever the last event was assistant speech — a
 * speech_delta or the speech_done marker that closes it. Stall baseline that resets on each
 * event, not a cap on total elapsed time.
 */
export const SPEECH_IDLE_TIMEOUT_MS = 45_000;

/**
 * Idle-gap watchdog deadline (ms) applied whenever the last event wasn't speech (speech_delta or
 * speech_done): the initial wait, and any wait after keepalive/tool_status/express/usage. The
 * backend may run context compaction or a tool round with no speech in flight, so these waits
 * get the long budget instead of the streaming-speech one.
 */
export const PRE_SPEECH_TIMEOUT_MS = 240_000;

/** Which watchdog budget expired — carried into the network_stall log. */
export type StallStage = "pre_speech_timeout" | "speech_idle_timeout";

/**
 * Idle-gap watchdog over a stream: yields events as they arrive, but stops (without
 * throwing) and calls `onIdle` with the expired stage if nothing lands in time. Each wait gets
 * `budgets.speechIdle` when the previous event was speech (per `isSpeech`), `budgets.preSpeech`
 * otherwise — reset on each event — so a tool round or compaction gap after speech isn't held to
 * the short streaming-speech deadline, and only an actual stall aborts the turn.
 */
export async function* withIdleWatchdog<T>(
  source: AsyncIterable<T>,
  budgets: { preSpeech: number; speechIdle: number },
  onIdle: (stage: StallStage) => void,
  isSpeech: (ev: T) => boolean,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  let lastWasSpeech = false;
  while (true) {
    const next = it.next();
    let timer: ReturnType<typeof setTimeout>;
    const idle = new Promise<"idle">((resolve) => {
      timer = setTimeout(
        () => resolve("idle"),
        lastWasSpeech ? budgets.speechIdle : budgets.preSpeech,
      );
    });
    const race = await Promise.race([next.then((r) => ({ done: r.done, value: r.value })), idle]);
    clearTimeout(timer!);
    if (race === "idle") {
      onIdle(lastWasSpeech ? "speech_idle_timeout" : "pre_speech_timeout");
      // the abandoned `next` will settle once the aborted stream unwinds — swallow it
      // so it doesn't surface as an unhandled rejection.
      next.catch(() => {});
      return;
    }
    if (race.done) return;
    lastWasSpeech = isSpeech(race.value as T);
    yield race.value as T;
  }
}
