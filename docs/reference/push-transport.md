# Push transport

`chat_api: "push"` connects the client to the backend over one WebSocket. The client sends turns on it and the backend sends finished replies on it. The connection stays open, so a reply arrives without a request, including a report on work the backend finished on its own.

Push is an optional extension for backends that can deliver without a request. Request-scoped features behave the same over the request transports — the Responses API, and Chat Completions where its wire carries the data — so a backend that does not speak push loses none of them.

The client renders what arrives and judges nothing. Everything the backend must know is in this document; the backend adapter for a specific agent lives under `integrations/<agent>/`.

## What each chat transport carries

| | Chat Completions | Responses | Push |
|---|---|---|---|
| Screenshot of the turn | `screenshot:` line and an `image_url` part | `screenshot:` line and an `input_image` part | `screenshot:` line, plus the pixels in `turn.images` when the backend states `max_turn_bytes` |
| Images the user attaches | `image_url` parts | `input_image` parts | In `turn.images`, after the screenshot, when the backend states `max_turn_bytes`; otherwise None |
| Client-declared tools and their results ([client-tools.md](client-tools.md)) | `tools[]` on every request | `tools[]` on every request while `broker_base_url` is unset | `tool_call` for a tool the client declared in `hello.tools`, answered with `tool_result`. Cues arrive in `render` and `speech` segments |
| Server error text on a failed user turn | Status and server text of an HTTP error on the request, 401 and 403 excepted. Status and server text of an error raised while reading the stream when it carries a status; generic text otherwise | Status and server text of an HTTP error, 401 and 403 excepted. Status and server text of an error raised while reading the stream when it carries a status; generic text otherwise. Generic text for an `error`, `response.failed` or `response.incomplete` event | The `message` of the `error` frame the turn got before its `turn_end`, with no status; generic text without one, which is also what a backend that does not send `error` frames gives |
| Token usage readout | Usage chunk of each request | `usage` of `response.completed` | `usage` of the `turn_end` frame |
| Model, `reasoning_effort` and instructions sent with the turn | All three | All three | None |
| Reasoning display | `reasoning_content` and `reasoning` deltas | Reasoning and reasoning-summary deltas | `reasoning` frames and the `render` frame's `reasoning` |
| Tool progress status | `done` for a tool the backend runs | `running` and `done` | `tool_status` frames |
| Stop | Request aborted | Request aborted | `stop` frame |
| Session reset | Transcript boundary on the client | Stored response id cleared on the client | `reset` frame |
| Holder of the conversation | Client transcript, sent with each request | Backend, chained by `previous_response_id` | Backend, under `chat_id` |
| Speech the backend starts with no request | None | None | `render` under a `turn_id` the backend mints |
| Delegations list | None | None | `delegations` frames |

## Limits

| Name | Value |
|---|---|
| Reconnect delay, first attempt | 1 s |
| Reconnect delay, growth | doubles per failed attempt |
| Reconnect delay, cap | 30 s |
| `hello` reply wait | 10 s |
| Frame wait, per turn | 240 s |
| Text frame size, either direction, every frame but `turn` and `tool_result` with images | 256 KiB |
| `turn` frame size | 256 KiB, or the `max_turn_bytes` value the backend stated in `ready` |
| Delegation item `title` | 120 characters |
| Delegation item `summary` | 2,000 characters |
| Delegation list `items` | 50 entries |
| `done` item kept in the chip after `ended_at` | 30 min |
| Delegation history kept by the client | 200 items |
| `done` or `failed` state held in the status pill's tool segment before it clears | 1.5 s |
| `tool_call` wait, body action | 15 s on the client, 20 s on the backend adapter |
| `tool_call` wait, query | 2 s on the client, 7 s on the backend adapter |
| `tool_call` wait, browser | 32 s on the client, 40 s on the backend adapter |
| Text-only `tool_result` frame size | 256 KiB |
| `tool_result` frame size with a non-empty list of image data URLs | `max_turn_bytes` from `ready`, or 256 KiB when absent |
| `playback` frame size | The text frame size |
| `error.message` | The text frame size |

The backend cuts `title` and `summary` to their limits, counting Unicode code points.

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
  "accepts": ["error"],
  "vocabulary": {
    "emotion_ids": ["neutral", "happy", "sad"],
    "motion_ids": ["idle", "happy"],
    "emotion_text_mode": "enum",
    "emotion_text_map": { "😆": "joyfully", "👂": "whisper" }
  },
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "look",
        "description": "Read body state, perch targets, or a display screenshot; screen requests require user permission",
        "parameters": {
          "type": "object",
          "properties": {
            "at": { "type": "string", "enum": ["body", "perch_targets", "screen"] },
            "monitor": { "type": "integer", "description": "For screen: the display number used by body_action.monitor; omit for the character's display" }
          },
          "required": ["at"],
          "additionalProperties": false
        }
      }
    }
  ]
}
```

| Field | Value |
|---|---|
| `key` | The chat API key. It travels in this frame because the browser WebSocket API carries only the URL |
| `chat_id` | The conversation the backend keeps state under. Generated once per installation, stored in settings, reused on every connection |
| `accepts` | The frame type names the client reads beyond the base set: `ready`, `render`, `speech`, `turn_end`, `tool_status`, `tool_call`, `reasoning` and `delegations`. This client sends `["error"]`. Absent means the base set only. A backend sends a client no frame type outside the base set and its `accepts`, and reads a value that is not a list of strings as absent. The latest `hello` of the chat decides, including for frames the backend holds while the client is away |
| `vocabulary` | What the client renders right now. `emotion_text_mode` is `"free"` or `"enum"`; `emotion_text_map` is the tag table used in `enum` mode |
| `tools` | The function schemas the client declares on this connection, in the OpenAI function-tool shape. Absent when the client declares none. Fixed for the connection. The pet window under Tauri adds `browser` beside the avatar tools it declares |

A backend that does not read `accepts` sends no `error` frame and renders its failure line. A client that sends no `accepts` gets the rendered failure line.

### `ready` (backend → client)

```json
{ "type": "ready", "chat_id": "yui-3f9a2c1d" }
```

The frame may carry `max_turn_bytes`, a positive integer naming the largest `turn` frame the backend accepts, in UTF-8 bytes. Its presence also says the backend accepts `images` on a `turn`. When it is absent, `turn` frames are capped at 256 KiB and carry no images.

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

`client_context` is the block described in [client-context.md](client-context.md), exactly as the other modes send it. `text` is the user utterance, or `""` on a turn no user typed or spoke.

The frame may carry `images`, an array of `data:image/<subtype>;base64,<data>` strings: the turn's screenshot first when the turn has one, then the images the user attached. The client sends the field only to a backend whose `ready` carried `max_turn_bytes`, and omits it when the turn has no image. When the images would take the frame over the stated size, the client re-encodes the images that exceed an equal share of the room as smaller JPEGs before it sends.

Every frame the backend sends for the turn carries the same `turn_id`, and a `turn_end` frame closes it.

A backend that takes a new turn's text while it is still running an older one — into that run, or queued behind it — sends every frame that follows under the newer turn's `turn_id`, and closes both turns with their own `turn_end`. The client has stopped the older turn by then and drops frames that name it.

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

### `stop` (client → backend)

```json
{ "type": "stop", "turn_ids": ["1789365854947", "1789365854950"] }
```

The user pressed stop. `turn_ids` are the turns the client just stopped — every turn that was outstanding on the chat at that moment. The backend stops generating for those of them that are still running and sends each its `turn_end`; an id it no longer holds is ignored, and a turn that is not named — one the backend started after the client's stop — keeps running. A backend that cannot stop the named turns without also stopping an unnamed one ignores the frame. A backend that ignores `stop` stays correct: the client drops the stopped turns' frames until their `turn_end`, as it does without it. Whether stopping a turn also ends work that turn delegated is the backend's decision; a delegation it ends is reported through `delegations`. Sent only while the socket is `ready`.

### `playback` (client → backend)

```json
{ "type": "playback", "turn_id": "1789365854947", "ended": "failed" }
```

| Field | Value |
|---|---|
| `turn_id` | The client turn whose call failed |
| `ended` | `"failed"` |

The client sends one frame per saved failed record with a `turn_id`, after `ready` and only while connected. Records saved while disconnected are not replayed on reconnect; the next turn's `previous:` line carries the failed outcome. Interruption and completion are stored in the previous-turn record only. On interruption the `previous:` line names the cut utterance, carrying everything still owed. A complete outcome is omitted from the line.

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

The `render`, `speech` and `tool_status` frames still to come for a turn stopped that way are dropped, and its `turn_end` is the frame on which the client forgets the turn.

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
{ "type": "turn_end", "turn_id": "1789365854947", "usage": { "input_tokens": 1200, "output_tokens": 80, "total_tokens": 1280 } }
```

| Field | Value |
|---|---|
| `turn_id` | The turn the frame closes |
| `usage` | Optional. The token usage of the turn's last LLM call, not a sum over the turn: `input_tokens`, `output_tokens` and `total_tokens`, all numbers, the same figures the request transports' usage readout takes. The client shows `total_tokens` beside the context window size. Absent when the backend has no usage for the turn. A `usage` that does not carry all three as numbers is read as absent, and the frame still ends the turn |

Sent once per turn after its last `render`; a turn with no `render` sends it alone. It releases the running state the `turn` frame set. A backend that holds renders for a client that is away holds `turn_end` behind them, in the same order. A turn the backend interrupts to run a later turn on the same chat gets its `turn_end` after the later turn's frames. A turn whose text the backend takes into a turn already running on the same chat ends when that turn ends. A turn may get its `turn_end` before any of its renders; a `render` naming a turn the client has already closed still plays. A turn that fails gets its `turn_end` after its `error` frame, or after the backend's failure line renders when the client did not list `error` in `accepts`, or before the next turn's frames when the backend has no failure text. A `turn_end` for a turn the client does not hold is ignored.

### `error` (backend → client)

```json
{ "type": "error", "turn_id": "1789365854947", "message": "Provider returned 429: rate limit reached" }
```

| Field | Value |
|---|---|
| `turn_id` | The failed turn: the `turn` the client sent, or the id the backend minted |
| `message` | The backend's own failure text, one line |

Sent only to a client whose `hello` lists `error` in `accepts`, when a turn fails, before that turn's `turn_end`. The backend renders no failure line for that client. The `turn_end` still closes the turn. A turn that gets an `error` frame ends as failed on its `turn_end`: the client speaks its failure line, and shows `message` where it shows the server text of a failed request, as one line cut at 200 characters with no status in front. A turn the user typed shows it in the input's error line, and a turn the user spoke shows it in the status pill. The frame counts as a frame of the turn for the frame wait. An `error` frame for a turn the client did not send shows nothing, and one for a turn the user stopped is dropped.

### `tool_status` (backend → client)

```json
{ "type": "tool_status", "turn_id": "1789365854947", "state": "running", "tool_id": "read_file" }
```

| Field | Value |
|---|---|
| `state` | `"running"` when the tool call starts, `"done"` when it returns, `"failed"` when it failed |
| `tool_id` | The tool name as the backend knows it |

Sent while the turn runs, once per state change of a tool call. A failed call carries `"failed"` in place of `"done"`. It counts as a frame of the turn for the frame wait and leaves the running state, the thinking motion and speech as they are. A turn may carry none. A `tool_status` for a turn the client did not send shows the status pill's tool segment and speaks no tool phrase. A running tool that gets no `done` is cleared by the turn's `turn_end`, and by the socket leaving `ready`. A `tool_status` naming a tool the client declared and runs itself, `browser`, leaves the status pill as it is, since that tool's status comes from the client's own run, and still counts as a frame of the turn for the frame wait.

### `tool_call` (backend → client) and `tool_result` (client → backend)

A call against a tool the client declared in `hello.tools`.

```json
{
  "type": "tool_call",
  "id": "c-1a2b3c",
  "turn_id": "1789365854947",
  "name": "body_action",
  "arguments": { "action": "sit_on_window", "app": "Notes" }
}
```

| Field | Value |
|---|---|
| `id` | The call id, minted by the backend; the `tool_result` echoes it |
| `turn_id` | The turn the call belongs to: a client turn id, or one the backend minted |
| `name` | The tool name, one of the functions the client declared in `hello.tools` |
| `arguments` | The call's arguments, a JSON object shaped by the tool's schema |

```json
{ "type": "tool_result", "id": "c-1a2b3c", "turn_id": "1789365854947", "result": "ok" }
```

| Field | Value |
|---|---|
| `id` | The `tool_call` id this result answers |
| `turn_id` | The `tool_call`'s `turn_id` |
| `images` | Optional non-empty array of image data URLs beside the result text |
| `result` | The tool's answer, a string |

The client's rules:

1. Calls of one chat run one at a time, in arrival order; the client's wait starts when the call starts running.
2. A `tool_call` whose `name` is not in the declared set, whose `arguments` lack a field the action needs or carry a value it does not accept, or whose `turn_id` names a turn the client has stopped is answered at once with `error: <reason>` — `error: unknown tool`, `error: missing field <name>`, `error: invalid field <name>`, or `error: turn stopped`.
3. A `tool_call` whose `id` repeats one queued or running is dropped with a log line and not answered; an answer would resolve the original call's waiter.
4. A result whose frame would pass its applicable size limit is answered `error: result too large` instead. A result the client cannot send (the socket is not ready) is logged and dropped.
5. A `tool_call` the client cannot read, such as a field of the wrong type, is dropped with a `frame_malformed` log line and gets no `tool_result`; the backend's wait answers it.
6. The status pill takes its tool state from the backend's `tool_status` frames; the client emits no `tool_status` of its own for these calls. `browser` is the exception: the client runs it itself and shows its running and terminal state locally. A backend `tool_status` naming it does not change the status pill and still counts as a frame of the turn for the frame wait.

For an image result the client fits the images into the remaining frame budget with the same JPEG fitter used for `turn.images`. The final serialized frame, including ids and text, must fit the limit. When nothing fits, the result is `error: result too large` with no images. Text-only results keep the text frame cap.

The backend adapter's rules:

1. The handler of a declared tool sends `tool_call` and blocks on `tool_result` for the wait in the limits table, counted from the send.
2. The adapter sends one call at a time per chat: a handler whose chat has a call in flight waits for its turn, so the client never holds a queue in practice.
3. On `stop` naming the turn, on socket close and on socket replacement, every waiting and in-flight call of that chat or turn is answered `error: client disconnected` (or `error: turn stopped`) at once and never sent later.
4. A `tool_result` whose `id` is absent from the pending table is ignored.
5. A wait that passes answers `error: no reply from the client within <n> s`.

A client that declares `tools` against a backend that predates them hears nothing: the backend never sends `tool_call`. A backend that speaks `tool_call` against a client that sent no `tools` registers nothing.

### `reasoning` (backend → client)

The backend's reasoning as it is written, sent while the turn is running.

```json
{
  "type": "reasoning",
  "turn_id": "1789365854947",
  "delta": "The log is the first place to look."
}
```

| Field | Value |
|---|---|
| `turn_id` | The turn the reasoning belongs to |
| `delta` | The reasoning written since the previous `reasoning` frame |

Frames are coalesced, so one carries however much arrived in the window. They are best effort: a
backend under load drops them, and a turn may carry none at all. The `render` frame's `reasoning`
field is where the text arrives whole — from a frame that plays. A `render` dropped for a stopped
turn abandons the reasoning still streaming for that turn; a text an earlier render already
finished stays. A `reasoning` frame of a turn the user stopped is dropped like the turn's other
frames, and the turn's `turn_end` ends reasoning still showing.
While one turn's reasoning is streaming, the `reasoning` of a `render` that belongs to another turn
is not shown.

### `delegations` (backend → client)

The full list of work the backend has handed to background workers for this conversation, sent whenever it changes. The client replaces its list with each frame.

```json
{
  "type": "delegations",
  "items": [
    { "id": "d-7f21", "title": "Sort the regression test list", "started_at": 1789365854947, "state": "running" },
    { "id": "d-5a03", "title": "Check log file sizes", "started_at": 1789365123000, "state": "done", "ended_at": 1789365701000, "status": "ok", "summary": "All three logs are under 10 MB." }
  ]
}
```

| Field | Value |
|---|---|
| `id` | Stable per delegation |
| `title` | First line of the task the backend handed over, cut to the limit in the limits table |
| `started_at`, `ended_at` | Epoch milliseconds |
| `state` | `"running"` or `"done"`. A failed delegation is `"done"` with `status: "error"` |
| `status` | On a `done` item only. `"ok"`, `"error"`, or `"unknown"` when the backend cannot tell |
| `summary` | On a `done` item only, when the worker returned text: its final answer, cut to the limit in the limits table |

The client keeps the latest list; a `done` item leaves the chip 30 minutes after `ended_at`. The client also keeps a history of every item it has seen across backend restarts: past 200 items the oldest `done` ones are dropped, and a `running` item is never dropped. A `running` item a later frame leaves out is recorded as `done` with `status: "unknown"`. The history lives in `localStorage` under `yui.delegation_history`. The settings window's Session section lists the history and opens a finished item's `summary` under its row.

## Logging

A `turn` sent over the socket writes a turn record with `spoke_text: false`. A `render` writes a `push.render` record with `source`, `turn_id`, the segment count, whether any speech played, and whether speech was still owed when the frame arrived. A `render` dropped for a stopped turn is logged as a `render` line with `dropped: "cut_turn"` and `stopped_count`, how many stopped turns are still waiting for their `turn_end`. A `speech` frame writes `push.speech` to the app log with `turn_id` and the segment count; one dropped for a stopped turn also carries `dropped: "cut_turn"` and `stopped_count`. Before the turn's first `render`, a frame wait that reaches the limit writes `network_stall` with `stage: push_wait`, and a wait the socket leaving `ready` ended writes `network_drop` with the same stage. After the first `render`, both carry `stage: push_turn_end`, and the turn counts as delivered. A `turn_end` writes `push.turn_end` to the app log with `turn_id`. An `error` frame writes `push.error` with `turn_id` and `message`; one dropped for a stopped turn carries `dropped: "cut_turn"` and `stopped_count` instead. A turn that ends on its `turn_end` after an `error` frame writes no `network_drop` line. A `stop` that went out writes `push.stop` with the number of turns it named. A `tool_status` frame writes `push.tool_status` with `turn_id`, `state` and `tool_id`; one dropped for a stopped turn carries `dropped: "cut_turn"` and `stopped_count` instead. A frame over the size limit is never sent and is dropped unread on arrival; either case writes `frame_oversize` with `direction`. The app log carries `ws_open`, `ws_ready`, `ws_close` with the close code, and `ws_reconnect` with the delay.
