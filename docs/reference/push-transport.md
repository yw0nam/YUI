# Push transport

`chat_api: "push"` connects the client to the backend over one WebSocket. The client sends turns on it and the backend sends finished replies on it. The connection stays open, so a reply arrives without a request, including a report on work the backend finished on its own.

The client renders what arrives and judges nothing. Everything the backend must know is in this document; the backend adapter for a specific agent lives under `integrations/<agent>/`.

## Limits

| Name | Value |
|---|---|
| Reconnect delay, first attempt | 1 s |
| Reconnect delay, growth | doubles per failed attempt |
| Reconnect delay, cap | 30 s |
| `hello` reply wait | 10 s |
| Frame wait, per turn | 240 s |
| Text frame size, either direction | 256 KiB |
| Delegation item `title` | 120 characters |
| Delegation list `items` | 50 entries |
| `done` item kept on the client after `ended_at` | 30 min |

## Connection

The client opens `wss://` (or `ws://`) to `chat_base_url` with the path `/ws`. A `chat_base_url` of `https://host:8646` gives `wss://host:8646/ws`.

Every frame is one JSON object with a `type` field. The client sends `hello` first. Other frames follow the backend's `ready`. A `hello` without a `ready` inside the wait in the limits table closes the socket and schedules a reconnect.

The client reconnects with the delay schedule in the limits table on every close but `4401`, and resets the delay to the first value after a `ready`. A `4401` close arms no retry: the socket stays closed until the protocol, endpoint or key setting changes, or until the user asks for a reconnect. A turn that starts before `ready` ends as a network failure, and so does a turn still running when the socket leaves `ready`.

### `hello` (client → backend)

```json
{
  "type": "hello",
  "key": "<chat API key>",
  "chat_id": "yui-3f9a2c1d",
  "vocabulary": {
    "emotion_ids": ["neutral", "happy", "sad"],
    "motion_ids": ["idle", "happy"],
    "emotion_text_mode": "enum",
    "emotion_text_map": { "😆": "joyfully", "👂": "whisper" }
  }
}
```

| Field | Value |
|---|---|
| `key` | The chat API key. It travels in this frame because the browser WebSocket API carries only the URL |
| `chat_id` | The conversation the backend keeps state under. Generated once per installation, stored in settings, reused on every connection |
| `vocabulary` | What the client renders right now. `emotion_text_mode` is `"free"` or `"enum"`; `emotion_text_map` is the tag table used in `enum` mode |

### `ready` (backend → client)

```json
{ "type": "ready", "chat_id": "yui-3f9a2c1d" }
```

The backend closes the socket with code `4401` on a wrong key and sends nothing. The client holds that close as a failed state and stops retrying.

### `vocabulary` (client → backend)

The `vocabulary` object from `hello`, sent again whenever the renderable set changes while connected.

```json
{ "type": "vocabulary", "vocabulary": { "emotion_ids": ["neutral"], "motion_ids": [], "emotion_text_mode": "free", "emotion_text_map": {} } }
```

## Turns

### `turn` (client → backend)

```json
{
  "type": "turn",
  "turn_id": "1789365854947",
  "client_context": "<client_context>\nClient-injected context; not typed by the user.\ntime: 2026-09-14T15:04:14+09:00 (Asia/Seoul)\ntrigger: user message\n</client_context>",
  "text": "How did the tests go?"
}
```

`client_context` is the block described in [client-context.md](client-context.md), exactly as the other modes send it. `text` is the user utterance, or `""` on a turn no user typed or spoke. Every frame the backend sends for the turn carries the same `turn_id`, and a `turn_end` frame closes it.

A `turn_id` names one turn for as long as the backend remembers it. The client reads the wall clock when a run starts and counts up from there, one per turn. A run moves the counter on by its turn count and a restart reseeds from the clock, so a late `render` from a run that began at an earlier clock reading carries an id below the range this run issues. A run the backend starts on its own, such as a report on finished work, carries a `turn_id` the backend mints. Backend ids never collide with client ids; the backend adapter states the form its ids take.

The client shows the turn running from the `turn` frame to its `turn_end`:

1. The composer is locked and the send button becomes a stop button, until `turn_end`.
2. The message plate reads thinking, until `turn_end`.
3. The character plays the thinking motion and speaks the filler line, until the first `render` of the turn.

The client waits for each frame of the turn for the wait in the limits table, counted from the `turn` frame and again from every frame carrying its `turn_id`. The wait passing before the first `render` ends the turn and the client speaks a failure line. The wait passing after the first `render` ends the turn and writes a log line. The socket leaving `ready` ends the turn at once, with the same two outcomes. A `render` that arrives after the turn ended this way plays like any other frame, as long as the turn is still outstanding: a turn whose wait ended stays outstanding, so the next user action that stops speech stops it too and its late `render` is dropped.

### `reset` (client → backend)

```json
{ "type": "reset" }
```

The backend starts a new conversation under the same `chat_id`. Long-term memory the backend keeps across conversations stays. The transcript starts empty. Work the backend delegated in the old conversation ends with it, and the next `delegations` frame lists nothing.

## Replies

### `render` (backend → client)

```json
{
  "type": "render",
  "turn_id": "1789365854947",
  "source": "hermes",
  "segments": [
    { "cues": [{ "emotion_id": "happy" }], "speech": "All green." },
    { "cues": [{ "emotion_id": "curious", "emotion_text": "👂" }], "speech": "Want the slow ones listed?" }
  ]
}
```

| Field | Value |
|---|---|
| `turn_id` | The turn this frame belongs to: the `turn` the client sent, or the id the backend minted for a run it started on its own |
| `source` | Backend name for logs |
| `segments` | Ordered. Each segment's `cues` render first, then its `speech` goes to TTS and the bubble |
| `reasoning` | Optional. The reasoning written so far for this turn when this reply was sent; on the last reply of the turn, the whole text. A backend that sends no `reasoning` frames may put a shortened version here instead. Absent when the backend produced none |

A cue is a `generate_express` argument object as defined in [client-context.md](client-context.md): `emotion_id`, `motion_id`, `emotion_text`, `caption`, all optional. Cues render through the same path a streamed cue takes.

Silence is a `render` whose segments carry no speech: every `speech` is empty or the bare `[SILENT]` token. Cues on a silent render still play. A turn with cues and no speech is one `render` whose single segment carries the cues and an empty `speech`; a turn with nothing to render sends only its `turn_end`. A cue on a silent segment renders as it arrives when nothing is playing, and at the next playback boundary when speech is still owed. Every cue waiting on a boundary fires at the first one playback reaches, so a cue belonging to a reply still being synthesised lands before that reply's speech. A cue that arrives while the character plays the thinking motion of another running turn lands when that motion ends.

A `render` plays after the speech already queued, in the order the frames arrived. Three user actions stop speech:

1. A turn the user typed or spoke.
2. Voice barge-in.
3. The stop button.

The `render` and `speech` frames still to come for a turn stopped that way are dropped, and its `turn_end` is the frame on which the client forgets the turn.

### `speech` (backend → client)

One finished sentence of a reply the backend is still writing.

```json
{ "type": "speech", "turn_id": "1789365854947", "segments": [ { "cues": [{ "emotion_id": "happy" }], "speech": "All green." } ] }
```

| Field | Value |
|---|---|
| `turn_id` | The turn this frame belongs to, as on `render` |
| `segments` | The `render` segment shape, played the same way. The backend sends one sentence per frame |

A `speech` frame counts as a frame of the turn for the frame wait, and the first one counts as the turn's first `render`.

The `speech` frames of a turn open one utterance. The next `render` of that turn plays its segments and closes the utterance, a silent `render` included. That `render` carries the rest of the reply and the cues still unplaced.

The utterance also closes on the turn's `turn_end`, on the frame wait passing, and on the socket leaving `ready`. The sentences already sent finish playing. A `render` or `speech` frame of another turn closes the open utterance before it plays. A user action that stops speech ends the utterance through the same interruption that stops a `render`.

The backend cuts `speech` frames from its reply while it is still writing it, and the client plays them as they arrive:

1. A `speech` sentence may join two lines of the finished reply with no space between them, and a cue that names the second line then plays later in the reply.
2. `speech` frames may repeat a sentence.
3. The `render` may repeat sentences already sent as `speech`.
4. A turn may carry no `speech` frames, and its whole reply then arrives in the `render`.

### `turn_end` (backend → client)

```json
{ "type": "turn_end", "turn_id": "1789365854947" }
```

Sent once per turn after its last `render`; a turn with no `render` sends it alone. It releases the running state the `turn` frame set. A backend that holds renders for a client that is away holds `turn_end` behind them, in the same order. A turn the backend interrupts to run a later turn on the same chat gets its `turn_end` after the later turn's frames. A turn whose text the backend takes into a turn already running on the same chat ends when that turn ends. A turn may get its `turn_end` before any of its renders; a `render` naming a turn the client has already closed still plays. A turn that fails gets its `turn_end` after the backend's failure line renders, or before the next turn's frames when no failure line comes. A `turn_end` for a turn the client does not hold is ignored.

### `tool_status` (backend → client)

```json
{ "type": "tool_status", "turn_id": "1789365854947", "state": "running", "tool_id": "read_file" }
```

| Field | Value |
|---|---|
| `state` | `"running"` when the tool call starts, `"done"` when it returns |
| `tool_id` | The tool name as the backend knows it |

Sent while the turn runs, once per state change of a tool call. It counts as a frame of the turn for the frame wait and leaves the running state, the thinking motion and speech as they are. A turn may carry none. A `tool_status` for a turn the client did not send shows the tool chip and speaks no tool phrase.

### `reasoning` (backend → client)

The backend's reasoning as it is written, sent while the turn is running.

```json
{
  "type": "reasoning",
  "delta": "The log is the first place to look."
}
```

| Field | Value |
|---|---|
| `delta` | The reasoning written since the previous `reasoning` frame |

Frames are coalesced, so one carries however much arrived in the window. They are best effort: a
backend under load drops them, and a turn may carry none at all. The `render` frame's `reasoning`
field is where the text arrives whole — from a frame that plays. A `render` dropped for a stopped
turn abandons the reasoning still streaming for that turn; a text an earlier render already
finished stays.

### `delegations` (backend → client)

The full list of work the backend has handed to background workers for this conversation, sent whenever it changes. The client replaces its list with each frame.

```json
{
  "type": "delegations",
  "items": [
    { "id": "d-7f21", "title": "Sort the regression test list", "started_at": 1789365854947, "state": "running" },
    { "id": "d-5a03", "title": "Check log file sizes", "started_at": 1789365123000, "state": "done", "ended_at": 1789365701000 }
  ]
}
```

| Field | Value |
|---|---|
| `id` | Stable per delegation |
| `title` | First line of the task the backend handed over, cut to the limit in the limits table |
| `started_at`, `ended_at` | Epoch milliseconds |
| `state` | `"running"` or `"done"`. A failed delegation is `"done"`; the backend says what happened in speech |

The client keeps the latest list. A `done` item leaves it 30 minutes after `ended_at`.

## Logging

A `turn` sent over the socket writes a turn record with `spoke_text: false`. A `render` writes a `push.render` record with `source`, `turn_id`, the segment count, whether any speech played, and whether speech was still owed when the frame arrived. A `render` dropped for a stopped turn is logged as a `render` line with `dropped: "cut_turn"` and `stopped_count`, how many stopped turns are still waiting for their `turn_end`. A `speech` frame writes `push.speech` to the app log with `turn_id` and the segment count; one dropped for a stopped turn also carries `dropped: "cut_turn"` and `stopped_count`. A frame wait that reaches the limit writes `network_stall` with `stage: push_wait`, and a wait the socket leaving `ready` ended writes `network_drop` with the same stage. A `turn_end` writes `push.turn_end` to the app log with `turn_id`. The app log carries `ws_open`, `ws_ready`, `ws_close` with the close code, and `ws_reconnect` with the delay.
