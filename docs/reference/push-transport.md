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
| First `render` wait, per turn | 240 s |
| Text frame size, either direction | 256 KiB |
| Delegation item `title` | 120 characters |
| Delegation list `items` | 50 entries |
| `done` item kept on the client after `ended_at` | 30 min |

## Connection

The client opens `wss://` (or `ws://`) to `chat_base_url` with the path `/ws`. A `chat_base_url` of `https://host:8646` gives `wss://host:8646/ws`.

Every frame is one JSON object with a `type` field. The client sends `hello` first. Other frames follow the backend's `ready`. A `hello` without a `ready` inside the wait in the limits table closes the socket and schedules a reconnect.

The client reconnects with the delay schedule in the limits table on every close but `4401`, and resets the delay to the first value after a `ready`. A `4401` close arms no retry: the socket stays closed until the protocol, endpoint or key setting changes, or until the user asks for a reconnect. A turn that starts before `ready` ends as a network failure, and so does a turn waiting for its first `render` when the socket leaves `ready`.

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

`client_context` is the block described in [client-context.md](client-context.md), exactly as the other modes send it. `text` is the user utterance, or `""` on a turn no user typed or spoke. Every reply to the turn is a `render` frame carrying the same `turn_id`.

A `turn_id` names one turn for as long as the backend remembers it. The client reads the wall clock when a run starts and counts up from there, one per turn. A run moves the counter on by its turn count and a restart reseeds from the clock, so a late `render` from a run that began at an earlier clock reading carries an id below the range this run issues.

The client holds the turn open until the first `render` carrying its `turn_id`, and shows the turn running for that whole time:

1. The composer is locked and the send button becomes a stop button.
2. The message plate reads thinking.
3. The character plays the thinking motion and speaks the filler line.

The wait in the limits table passing before a `render` arrives, or the socket leaving `ready`, ends the wait and the client speaks a failure line. A `render` that arrives after the wait ended plays like any other frame, as long as the turn is still outstanding: a turn whose wait ended this way stays outstanding, so the next user action that stops speech stops it too and its late `render` is dropped.

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
| `turn_id` | The `turn` this answers, or `null` when the backend speaks on its own. A frame that leaves the field out reads as `null` |
| `source` | Backend name for logs |
| `segments` | Ordered. Each segment's `cues` render first, then its `speech` goes to TTS and the bubble |
| `reasoning` | Optional. The reasoning written so far for this turn when this reply was sent; on the reply that ends the turn, the whole text. A backend that sends no `reasoning` frames may put a shortened version here instead. Absent when the backend produced none |

A cue is a `generate_express` argument object as defined in [client-context.md](client-context.md): `emotion_id`, `motion_id`, `emotion_text`, `caption`, all optional. Cues render through the same path a streamed cue takes.

Silence is a `render` whose segments carry no speech: every `speech` is empty or the bare `[SILENT]` token. Cues on a silent render still play. A `render` with an empty `segments` array closes the turn. A cue on a silent segment renders as it arrives when nothing is playing, and at the next playback boundary when speech is still owed. Every cue waiting on a boundary fires at the first one playback reaches, so a cue belonging to a reply still being synthesised lands before that reply's speech.

A `render` plays after the speech already queued, in the order the frames arrived. Three user actions stop speech:

1. A turn the user typed or spoke.
2. Voice barge-in.
3. The stop button.

The renders still to come for a turn stopped that way are dropped. A `render` with `turn_id: null` always plays.

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

A `turn` sent over the socket writes a turn record with `spoke_text: false`. A `render` writes a `push.render` record with `source`, `turn_id`, the segment count, whether any speech played, and whether speech was still owed when the frame arrived. A `render` dropped for a stopped turn is logged as a `render` line with `dropped: "cut_turn"` and `stopped_count`, how many turns the user has stopped this session. A wait that reaches the limit writes `network_stall` with `stage: push_wait`, and a wait the socket leaving `ready` ended writes `network_drop` with the same stage. The app log carries `ws_open`, `ws_ready`, `ws_close` with the close code, and `ws_reconnect` with the delay.
