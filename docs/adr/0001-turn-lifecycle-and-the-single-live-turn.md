# Turn lifecycle: a ledger, and one live turn

A Turn spans admission to the backend until its audio has drained, and `src/dispatcher/turn.ts` owns
turn identity and the single definition of "over" (`settled && !audioOwed`). It is a ledger, not an
authority: the dispatcher's queueing, the TTS pipeline's ordering and the abort paths keep their own
logic and report to it. At most one turn is live — `begin()` retires the previous one.

## Considered options

**Scoping a turn to `backend-caller.call()`.** Rejected: a turn's lifetime exceeds that function's at
both ends. `shouldHoldForPlayback` reads playback state after the call resolves, and the TTS pipeline
queues completion boundaries because one turn's audio outlives its call. Identity scoped inside `call()`
cannot cover a turn, so most of the modules deciding a turn had ended could not consult it.

**Making the Turn an authority** that gates each module. Rejected: the queueing and ordering logic it
would replace is not where the defects are.

**A registry of concurrently live turns.** Rejected as YAGNI, deliberately and with the knowledge that
it may be wanted later.

**A linear phase enum** (`calling → streaming → speaking → done`). Rejected because the phases overlap:
sentence 1's audio plays while sentence 3's text is still streaming. The ledger holds the two completion
conditions instead, and any phase label is derived at the read site.

## Consequences

One live turn is not an invariant the ledger enforces. It holds because of two facts elsewhere in the
system, and if either changes, the single-turn model is the first thing to break:

1. `backend-caller` calls `turnOutput.interrupt()` on call entry, synchronously before its first
   `await`. That disposes the TTS pipeline and stops the sink, so a previous turn's audio cannot survive
   into the new turn.
2. `dispatcher` holds a non-user turn while audio is owed, so a second turn is not admitted underneath a
   speaking one.
3. A supersede either admits a successor turn or aborts speech, so an aborted turn's audio is never left
   playing with nothing to report it finished. User envelopes carry `dnd_override: true`, which
   short-circuits `guardrails.evaluate` to pass, so `supersedeByUser` always admits its successor; the
   only production `cancel()` call sites pair it with an explicit speech abort. If either is relaxed, an
   aborted mid-stream turn can leave `audioOwed` stuck true with no successor to clear it.

Identity is carried by the caller, not looked up. `thinkingStart`/`thinkingEnd` take the turn id as an
argument because a callee reading the ledger cannot tell which turn called it: a superseded turn's late
`thinkingEnd` would match whatever turn is current and tear down live state. For the same reason
`settle` takes an id — the dispatcher holds one across an await. `setAudioOwed` takes none: it is a
synchronous read of the single live audio pipeline, with no window in which it could describe another
turn.

Two questions are answered separately, because they are not the same question: `isAudioOwed()` for the
tap-emotion revert and voice barge-in, `isOver()` for turn admission and pipeline-busy. Answering the
first with `!isOver()` suppresses the tap-emotion revert while a silent backend call is in flight, and
nothing re-arms that timer.
