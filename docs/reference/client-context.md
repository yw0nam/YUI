# Client Context ↔ Backend Agent

This is **not a wire schema** — `client_context` is prompt text riding inside the
turn's user message. Nothing on either side parses it programmatically; its only
reader is the backend model, so the format only has to stay stable and readable to a
model, not machine-parseable. It applies to both chat protocols YUI supports
(`chat_api` in `configs/endpoints.json`). The sections below describe Responses mode;
Chat Completions mode carries the same rendered lines and the same `generate_express`
cue over a different transport, where the client declares the tool itself and answers
the call — see [CC mode transport](#cc-mode-transport-chat-completions) at the end of
this doc for the deltas.

## Per-turn client context (client → agent)

Each turn the client sends a Responses API request with a single `user` input followed
by `instructions` (static persona/global rules, config-driven). That input carries the
current context in a tagged block, then the utterance:

```text
<client_context>
Client-injected context; not typed by the user.
time: 2026-06-15T19:30:00+09:00 (Asia/Seoul)
frontmost: Google Chrome — "H-Index | Programmers" (for 4min)
trigger: user message
</client_context>

The user's message text, or a per-trigger background marker when no user utterance exists
```

The `input` array has no system slot: its last item becomes the turn's user message
regardless of role, and earlier items land in plain conversation history, so a
`system` item there never reaches the model as a system instruction. Context leads the
block and the utterance trails it — recall on the trailing utterance holds as the
context grows.

When a screenshot is attached, the input is a content-part array: `[{ type:
"input_text", text }, { type: "input_image", image_url }]`, where `text` is the block
above. Otherwise it is plain text.

## Rendered lines

Everything between the header line and the closing tag is a sequence of `key: value`
plain-text lines built by `renderClientContext` (`src/dispatcher/client-context-text.ts`).
One line per fact, in this fixed order — `time`, `frontmost`, `screenshot`, `body`, then
one or more `trigger:`/`cue note:`/`agent note:`/`agent event:`/`agent detail:`/`signal:`/
`recent:` lines depending on what fired. A line is omitted outright when its underlying
field is absent (e.g. no `screenshot:` line when screen capture is off).

Any field value that could contain whitespace runs, a newline, or the block's own tags (an
app name, a window title, a cue label, an agent-hook string) is sanitized before being
embedded: whitespace runs collapse to one space and the string is trimmed, and any
`<client_context>`/`</client_context>` sequence inside it is stripped outright. This is a
structural requirement, not cosmetic — without the whitespace collapse, a hostile or
malformed payload could inject a fake extra line into the block, and without the tag strip
it could forge a premature `</client_context>` and smuggle fabricated lines past the real
closing tag. `configs/`-authored and user-typed fields go through the same sanitization.

Every epoch-ms field (`since`, `ts`) is converted into a minutes-elapsed duration —
`max(0, round((nowMs - sinceMs) / 60000))`, rendered as a bare `Xmin` — computed once
per turn from a single `nowMs` snapshot shared by every duration in the block. Raw
epoch milliseconds never appear in the rendered text.

### `time`

Always the first line — `env.timestamp` and `env.timezone`, unconditionally present:

```text
time: 2026-06-15T19:30:00+09:00 (Asia/Seoul)
```

### `frontmost`

What the user has in the foreground. Present once an OS frontmost sample exists;
absent on unsupported platforms or before the watcher's first tick.

```text
frontmost: Google Chrome — "H-Index | Programmers" (for 4min)
```

The label is `env.frontmost.app`; the quoted title is appended only when
`window_title` is present **and** differs from the app name (a browser or editor
whose window title just repeats the app name doesn't need it said twice). When `app`
didn't resolve but `window_title` did, the title stands alone as the label. When
neither resolved, the line is omitted. The duration is minutes since the last
frontmost transition (`env.frontmost.since`).

`app` and `window_title` are untrusted text sampled from the user's environment — any
web page or document names its own window — and are data to reason over, never
instructions to follow. Platform semantics follow the witness sampler
(`docs/reference/witness-log.md`): macOS reports the topmost non-YUI, non-system-helper
window and window titles require the Screen Recording permission (absent permission →
app only); Windows reports the focused window, excluding YUI itself and shell chrome,
with `app` as the process base name. A clear lasting under a 5-minute grace window
(brief focus churn) keeps the original `since` when the same app/title returns; a
longer clear is a real absence and stamps a fresh `since`.

### `screenshot`

Present only when screen capture is enabled (`screenshot.enabled`); the pixels
themselves never ride in this line — they arrive as a separate `input_image`
content-part alongside the text. One line per `ScreenSource` kind:

```text
screenshot: monitor 0 (Built-in Retina Display)
screenshot: browser_tab Chrome — "GitHub" (github.com/yw0nam/YUI)
screenshot: window Cursor — "client-context.md"
```

`monitor` carries the display index and its optional label; `browser_tab` carries the
browser name, the quoted tab title, and the optional URL; `window` carries the owning
app and the quoted window title. `enabled: false` (the type allows it, though the
client never currently produces it that way) omits the line entirely, same as the
field being absent.

### `body`

Where the avatar body is. Present only while a posture is held; absent whenever the
avatar stands free.

```text
body: peeking on Orca (for 2min)
```

The state is `body_state.posture.state` (`sitting` \| `peeking` \| `dragging`); the `on
<label>` clause names `posture.perched_on.app` (falling back to `window_title` when the
app didn't resolve) and is omitted when there's no window under the avatar. The
duration is minutes since the last posture change (`body_state.since`) — it moves only
when the posture itself changes, not when the same posture is re-affirmed.

## Trigger lines

Exactly one headline `trigger: …` line describes what fired the turn, chosen by what
the turn actually carries (screen transition, cue, single agent event, agent catchup
burst, or a bare kind fallback); zero or more follow-up lines add detail. `trigger.kind`
is one of `user` \| `schedule` \| `proactive` \| `agent` \| `signals`.

| `kind` | What fired | User content |
|---|---|---|
| `user` | User spoke or typed | The user's message text |
| `schedule` | A user-configured time-of-day cue fired | Background marker |
| `proactive` | A configured engagement cue, tap-bored cue, region-touch cue, or screen transition fired | Background marker |
| `agent` | An external coding-agent lifecycle hook posted a completion or needs-input signal | Background marker |
| `signals` | An external producer POSTed a burst to the `/signals` ingress | Background marker |

For `schedule`, `proactive`, `agent`, and `signals` turns there is no user utterance —
the agent reads the trigger lines to decide whether and what to say. Firing a turn does
not guarantee speech: the client renders whatever text the agent returns, and silence
means the agent returns empty or no speech text. No client-side gate decides whether to
speak (firing ≠ judgment).

### `trigger: user message`

```text
trigger: user message
```

### Cue (schedule / proactive)

```text
trigger: proactive "focus break reminder" (user idle 37min)
cue note: remind user to take a break if they're focusing for too long
```

The label is quoted verbatim (collapsed to one line). The `(user idle Xmin)` clause
appends only when `idle_elapsed_min` is present (idle-triggered proactive cues); a
schedule cue never carries it. A second `cue note:` line follows only when
`cue.context` is present — free-text intent the user authored for that cue. The
built-in touch and gesture cues (`touch_*`, `tap_bored`, `drag_held`, `window_sit`,
`peek`) send a label alone unless the user authored a `context` for them in
`configs/avatar.json`, so most of those turns render just the headline. A proactive
turn with `idle_elapsed_min` but no cue at all (no configured label) falls back to a
bare `trigger: proactive (user idle Xmin)`.

### Screen transition

```text
trigger: screen app_switched, left Google Chrome after 1min, in current app 0min
trigger: screen long_session, in current app 45min
```

`app_switched` fires when the user leaves an app they'd held for a while and settles
into another; `long_session` fires while one app keeps the foreground across long
stretches. The `, left <app> after Xmin` clause appears only when both `from_app` and
`from_dwell_min` are present — `long_session` never carries a `from_app`, and an
`app_switched` turn missing `from_dwell_min` drops the whole clause rather than
printing an `after 0min` that would misreport an unknown duration as zero. `in current
app Xmin` (`dwell_min`) always closes the line. The app switched *to* is the
`frontmost:` line above, not repeated here; the departed window's title isn't carried —
a title the user has already left is history, not present state.

### `recent` (held transitions)

While the global proactive pacer holds screen fires back for its gap window, each
`app_switched` transition it suppresses is accumulated rather than dropped. The next
screen turn that actually fires — either transition kind — carries the held path as an
extra line. The transition that actually fires is a separate, later switch, not the
last held one:

```text
trigger: screen app_switched, left VS Code after 12min, in current app 2min
recent: Cursor 10min -> Slack, Slack 3min -> VS Code
```

`recent` lists the held `app_switched` transitions in the order they happened, oldest
first, each rendered `<from_app> <dwell_min>min -> <to_app>`. A suppressed
`long_session` mark is not a transition and is never added to the buffer. The list is
capped (`recent_cap`, default 5) with the oldest entry dropped past the cap, so it may
show only a suffix of the full held path. The line appears only when the buffer is
non-empty at fire time; the buffer clears the instant it ships, when the feature is
turned off mid-hold, and on a presence lapse (the user stepping away resets it along
with the dwell and session clocks — an overnight-stale path never ships on the first
morning fire) — a later screen turn with nothing held during its own gap carries no
`recent` line at all.

### Agent lifecycle (single event)

```text
trigger: agent claude-code done (success), project "yui" (2min ago)
agent note: Extracted dev workflow into yui-dev-workflow skill and slimmed AGENTS.md.
```

```text
trigger: agent claude-code needs_input, project "yui" (0min ago)
agent detail: waiting on Bash: rm -rf /tmp/scratch
```

The headline carries `tool`, `phase`, the optional `(status)` (meaningful for
`phase:"done"` only), the quoted `project`, and how long ago the hook fired (`ts`). An
`agent note:` line follows when `summary` is non-empty; an `agent detail:` line follows
when `detail` is present (judgment material — a transcript excerpt or the pending tool
call). A payload the client couldn't validate (missing/malformed required fields)
leaves both trigger-detail fields absent and renders a bare `trigger: agent` headline
with no note/detail lines — the background marker still falls back to unnamed wording
in that case (see below).

### Agent lifecycle (catchup burst)

```text
trigger: agent catchup (2 events)
agent event: claude-code done (success), project "alpha" - "Done with alpha" (182min ago)
agent event: opencode done, project "beta" - "Done with beta" (2min ago)
```

One `agent event:` line per buffered item, oldest first, in the same shape as the
single-event headline, each with its own `(Xmin ago)` computed from that item's own
`ts` rather than the burst's — a task that finished hours ago and one that finished a
minute ago fired at different times and read differently, so each item keeps its own
elapsed time instead of collapsing to one figure for the whole burst. An `agent detail:`
line follows an item's line when that item carries `detail`. Buffered while the user is
away or the pipeline is busy (a backend call in flight or speech playback ongoing);
flushed as one turn on the return-to-present or busy-to-idle edge. Within the buffer, a
new event with the same `session_id` and `phase` as an already-buffered entry replaces
it in place rather than appending, so a session's repeated permission prompts can't
evict other sessions' buffered events out of the per-tool cap.

### Signals

```text
trigger: signals (2 signals)
signal: {"source":"github","repo":"acme/yui","event":"push","branch":"main"}
signal: {"source":"heartbeat","ts":1781000000000}
```

The headline gives the item count; one `signal:` line follows per item, each the
item's raw JSON on its own physical line — signals are opaque, heterogeneous objects
with no client-known shape (GitHub change, Notion task, heartbeat, or any future kind
the producer decides to emit), so JSON is the only representation that doesn't lose
structure. `signal:` lines are independent of the headline and appear whenever
`trigger.signals` is present, even alongside a cue headline: `proactive.tap_bored`
turns carry both their configured cue and any drained buffered signals in one turn.

## Deliberately omitted fields

A few `ClientContext` fields carry no rendered line, by design:

| Field | Why it's omitted |
|---|---|
| `cue.local_time` | Current local time when the schedule cue fires — redundant with the `time:` line, which already states the current instant |
| `cue.idle_min` | Configured idle *threshold* — redundant with `idle_elapsed_min`, which states the actual elapsed minutes that caused the cue to fire |
| `trigger.agent.cwd` (`agent_catchup` items carry no `cwd` field at all) | Host filesystem detail; the project name already identifies the work, and the agent has no use for a local path when reacting verbally |
| `trigger.agent.session_id`, `trigger.agent_catchup.items[].session_id` | An opaque hook-continuity token the client itself doesn't interpret (see below) — no verbal content for the backend to act on |

## Background markers

When there is no user utterance, the user input trails the `client_context` block with
a short, per-`event_name` notice of what fired. The string rides in the user role, so
it is written from the user's POV: "I" is the user, "you" is the agent. "You" is the
on-screen VRM avatar — the agent's body — so window_sit/peek markers describe the user
placing that body (drag & drop) and the agent's body ending up perched or peeking. It
states what happened, never how to respond (firing ≠ judgment). The string is
client-only framing so the agent has a concrete stimulus in the user turn; all
situational detail still lives in the trigger lines above.

| `event_name` | Marker text |
|---|---|
| `proactive.tap_bored` | `(I keep poking at you)` |
| `proactive.touch_*` | `(I just poked you)` |
| `proactive.drag_held` | `(I keep dragging you around)` |
| `proactive.window_sit` | `(I just sat you down on a window's edge)` |
| `proactive.peek` | `(I left you peeking out from the screen edge)` |
| `proactive.screen_app_switched` | `(I just moved over to something else on my screen)` |
| `proactive.screen_long_session` | `(I've been in the same thing on my screen for a while)` |
| `proactive.*` (other) | `(I've gone quiet for a while)` |
| `schedule.*` | `(it's the time of day you check in on me)` |
| `agent.done` | `(my claude-code task just finished)` |
| `agent.needs_input` | `(my claude-code task is waiting on my input)` |
| `agent.catchup` | `(my claude-code and opencode tasks piled up while I was away)` |
| `signals.push` | `(a new signal just arrived for you)` |
| `signals.catchup` | `(signals piled up while I was away)` |
| any other | `(something just caught your attention)` |

The `agent.*` markers name the coding agent that fired. `agent.done` and
`agent.needs_input` name `trigger.agent.tool`; `agent.catchup` lists the distinct
`trigger.agent_catchup.items[].tool` values in first-seen order, joined with commas
and `and` before the last, so a burst from a single tool names that one tool. A
payload the client could not validate leaves those trigger fields absent, and the
marker falls back to `(one of my coding tasks just finished)`, `(one of my coding
tasks is waiting on my input)`, and `(my coding tasks piled up while I was away)`.

The marker is the one place a payload field reaches the user role as bare prose, so
the tool name is normalized on the way in: runs of whitespace collapse to a single
space and the result is clamped to 40 characters, which keeps the marker one line and
keeps it a name. A name that normalizes to empty is dropped, and a `catchup` burst
left with no names falls back to the unnamed wording. The trigger line's own `tool`
value is collapsed the same whitespace-safe way (see "Rendered lines" above) but is
**not** clamped to 40 characters — only the marker is length-limited.

---

## Backend → Client: `generate_express`

## Purpose

Use `generate_express` to place expression cues between streamed assistant text segments.

The assistant reply is still normal streamed text. `generate_express` is called at the point where the face, motion, or voice tone should change.

## Tool Arguments

```ts
generate_express({
  emotion_id?: string;
  motion_id?: string;
  emotion_text?: string;
  caption?: string;
})
```

```json
{
  "emotion_id": "happy",
  "motion_id": "dance",
  "emotion_text": "🤭",
  "caption": "明るく弾んだ声で、少し早口に。"
}
```

| Field | Use |
|---|---|
| `emotion_id` | facial expression |
| `motion_id` | body motion |
| `emotion_text` | voice tone tag |
| `caption` | voice direction in natural language |

All fields are optional. Include only the fields that should change.

`emotion_text` and `caption` are two separate voice channels and combine freely.
`emotion_text` is a tag from the published emoji set, prepended to the spoken
segment. `caption` is a free sentence describing how the voice should sound —
Japanese reads best — carried beside the audio request rather than in the
speech. Neither is ever spoken aloud or shown in the speech bubble.

## Basic Pattern

Interleave text and tool calls in the order the user should experience them.

```text
text segment
generate_express({ ...cue for that segment... })
text segment
generate_express({ ...cue for that segment... })
```

Example:

```text
"Hello User!"
generate_express({ emotion_id: "happy", motion_id: "dance", emotion_text: "🤭" })
" How was your day?"
generate_express({ emotion_id: "curious", motion_id: "calm", emotion_text: "😏", caption: "穏やかに問いかけるように。" })
```

This means:

- say `"Hello User!"`;
- place a happy/dance/🤭 cue on that greeting;
- say `" How was your day?"`;
- place a curious/calm/😏 cue on the question, with the voice directed to sound
  like a gentle inquiry.

## Streaming Shape

```text
event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"Hello User!","sequence_number":2}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":1,"item":{"id":"fc_1","type":"function_call","name":"generate_express","arguments":"{\"emotion_id\":\"happy\",\"motion_id\":\"dance\",\"emotion_text\":\"🤭\"}"},"sequence_number":3}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":1,"item":{"id":"fc_1","type":"function_call","name":"generate_express","arguments":"{\"emotion_id\":\"happy\",\"motion_id\":\"dance\",\"emotion_text\":\"🤭\"}"},"sequence_number":4}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_1","delta":" How was your day?","sequence_number":5}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":2,"item":{"id":"fc_2","type":"function_call","name":"generate_express","arguments":"{\"emotion_id\":\"curious\",\"motion_id\":\"calm\",\"emotion_text\":\"😏\"}"},"sequence_number":6}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":2,"item":{"id":"fc_2","type":"function_call","name":"generate_express","arguments":"{\"emotion_id\":\"curious\",\"motion_id\":\"calm\",\"emotion_text\":\"😏\"}"},"sequence_number":7}

event: response.output_text.done
data: {"type":"response.output_text.done","item_id":"msg_1","text":"Hello User! How was your day?","sequence_number":8}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello User! How was your day?"}]}]},"sequence_number":9}
```

## Stream Liveness

The client aborts a turn whose stream stays silent for 45 seconds and drops
the triggering event. The deadline is an idle gap measured between stream
events, not a cap on total turn length, and every SSE event resets it —
including event types the client does not otherwise consume. A backend busy
with long non-streaming work (context compaction, retrieval) stays alive by
emitting any event periodically; SSE comment lines are stripped by the SDK
and do not count. `response.failed` / `response.incomplete` are terminal
errors, not liveness.

## Rules

- Put spoken words only in streamed assistant text.
- Put expression, motion, and voice tone only in `generate_express` arguments.
- Call `generate_express` multiple times when one reply has multiple expressive beats.
- Do not encode expression cues as inline text such as `[happy]`.
- Do not put the spoken sentence inside `generate_express`.

## Bad Patterns

```text
"[happy][dance] Hello User!"
```

```text
generate_express({
  emotion_text: "Hello User!"
})
```

```text
"Hello User! How was your day?"
generate_express({ emotion_id: "happy" })
```

The last example loses the timing. Use separate cues when different parts of the sentence need different expression.

## FAQ

### Do expression cues persist across sentences?

No. Call `generate_express` for every sentence that should have an expression cue.

After the motion loop finishes, expression and motion return to neutral/idle. If multiple sentences should keep the same happy expression or motion, call `generate_express` again for each sentence.

### What happens when text is streamed without `generate_express`?

The sentence is spoken normally with neutral voice tone and idle/neutral presentation.

Use no `generate_express` call when the sentence should stay neutral.

### When should `generate_express` be called?

Call it per sentence or per meaningful expressive beat.

Use it when the sentence needs a face, body motion, or voice tone cue. If the next sentence should use the same cue, call it again for that sentence.

### What values are valid?

Use the broker tool that returns valid ids before choosing values.

- Use `get_ids` to check valid `emotion_id`, `motion_id`, and `emotion_text` values.
- Do not rely on memorized value lists.
- The valid set can change.
- `caption` is free text and has no id list to check.
- Only `generate_express` changes facial expression, body motion, or voice tone.

### What does `generate_express({})` mean?

It is an error. Do not call `generate_express` with no arguments.

To keep the sentence neutral, stream the text without calling `generate_express`.

## CC mode transport (Chat Completions)

In Chat Completions mode (`chat_api: "chat_completions"`) the same rendered lines are
sent as the CC `messages` array instead of Responses `input[]`, and CC keeps a real
system slot: a `system` message with the persona/global instructions (if configured),
a `system` message with `client_context:\n<rendered lines>`, the trimmed conversation
transcript, then the `user` message carrying the utterance or background marker
alone.

### Client-declared tools

Every CC request carries the client's registered tools in `tools[]` as standard
OpenAI function schemas, and the client executes the calls it gets back.
`generate_express` is one of them, so expression works against any
OpenAI-compatible endpoint whose model supports tool calling — the backend
behind it needs neither the broker nor prior knowledge of this contract. The
schema is generated from the vocabulary the client has loaded, the same ids it
publishes to the broker:

| Parameter | Schema |
|---|---|
| `emotion_id` | `string`, `enum` = the loaded emotion registry's ids |
| `motion_id` | `string`, `enum` = the loaded motion registry's agent-triggerable ids (reactive, ambient, and `broker_publish: false` motions excluded), narrowed by the user's expression-motion selection |
| `emotion_text` | `string`; on an enum-mode TTS provider, `enum` = that provider's tag table with each tag's meaning in the description, otherwise free text |

Every declared parameter is optional and the object takes no other properties,
matching the [tool arguments](#tool-arguments) above. A vocabulary edit (a new
emotion, a new motion, a different voice engine, a changed motion selection)
reaches the schema on the next turn.

When the motion selection leaves no motion at all, `motion_id` is dropped from
the schema entirely rather than declared with an empty `enum`, and the tool
description drops its mention of body motion — the cue carries expression and
voice tone only. A cue that names a deselected motion still renders: the
selection curates what the model may choose, not what the client will play.

### Tool-call round trip

Cues arrive as `chat.completion.chunk` tool-call deltas
(`delta.tool_calls[].function.arguments`, accumulated per call index) instead of
`response.output_item.*` events. Each call naming a registered tool is executed
locally as it arrives, and `generate_express` plays its cue at that moment — cue
timing never waits for anything — resolving `ok`.

The round trip appends the assistant message carrying those `tool_calls` and one
`role: "tool"` message per call (`tool_call_id` + the result string) to the
message array of the turn in flight, then sends the whole array again with the
same `tools[]`. It happens when:

- **A tool that answers a question ran.** Its result is the reason the model
  called it, so the result always goes back and the model continues from there.
- **A cue-only tool ran, the response said nothing, and it ended with
  `finish_reason: "tool_calls"`.** The model stopped to wait, and the turn would
  otherwise be silent, so the results go back and the speech arrives next.

`generate_express` is cue-only: its result is a bare `ok`. So a response that
spoke alongside its cues is a complete turn — the cues played with the text,
exactly as in Responses mode — and a cue-only response that ended on
`finish_reason: "stop"` is a deliberate silence. Neither gets results back;
answering either would only make the model say everything again, and no client-
side rule pushes a silent turn into speech (firing ≠ judgment).

The cycle repeats while the model keeps asking. Three round trips per turn is the
cap; beyond it the client stops returning results and closes the turn with the
text it has.

A tool the client did not register runs on the backend, so the client only
observes it: it surfaces as tool status and gets no result. `generate_express`
under an MCP namespace (`mcp_<server>_generate_express`) is that case with its
cue still played — any tool name ending in `generate_express` plays its cue,
whichever side registered it, and only the exact registered name is answered.

Tool traffic lives in the in-flight message array only. Chat Completions has no
`previous_response_id`, and the next turn is rebuilt from the stored transcript,
which holds user and assistant speech text alone.

One round trip on the wire:

```jsonc
// request 1 — messages + tools[]
// response 1 — tool-call deltas, no text
{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"generate_express","arguments":"{\"emotion_id\":\"happy\",\"motion_id\":\"dance\"}"}}]},"finish_reason":null}]}
{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

// request 2 — the same messages and tools[], with these two appended
{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"generate_express","arguments":"{\"emotion_id\":\"happy\",\"motion_id\":\"dance\"}"}}]}
{"role":"tool","tool_call_id":"call_1","content":"ok"}

// response 2 — the spoken text
```

### Backend capability

Cue delivery over Chat Completions needs an endpoint that speaks standard
tool-call streaming. A plain OpenAI-compatible server (e.g. vLLM) does, and the
declared `generate_express` comes back as `delta.tool_calls` fragments. The
Hermes api-server's `/v1/chat/completions` does not surface tool calls at all —
it emits a custom `hermes.tool.progress` telemetry event (name + status, no
arguments) instead of `tool_calls` — so Hermes carries the full contract over
`responses` mode.
