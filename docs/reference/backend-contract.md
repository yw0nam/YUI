# Backend Agent ↔ Broker Interaction

This contract applies to both chat protocols YUI supports (`chat_api` in
`configs/endpoints.json`). The sections below describe Responses mode; Chat
Completions mode carries the same `client_context` shape and the same
one-way `generate_express` cue, over a different transport — see
[CC mode transport](#cc-mode-transport-chat-completions) at the end of this
doc for the deltas.

## Per-turn client context (client → agent)

Each turn the client sends a Responses API request with two inputs followed by `instructions` (static persona/global rules, config-driven). The inputs are:

| Index | Role | Content |
|---|---|---|
| `input[0]` | `system` | `client_context: <JSON>` — current context (no user utterance) |
| `input[1]` | `user` | The user's message text, or a per-trigger background marker when no user utterance exists (see [Background markers](#background-markers)) |

When a screenshot is attached, `input[1]` is a content-part array: `[{ type: "input_text", text }, { type: "input_image", image_url }]`. Otherwise it is plain text.

### `client_context` JSON shape

```jsonc
{
  "env": {
    "timestamp": "ISO 8601 local time with offset", // e.g. "2026-06-15T19:30:00+09:00"
    "timezone": "IANA zone (auto-detected)",    // e.g. "Asia/Seoul"
    "active_app": { "name": "foreground app" }, // optional
    "active_window_title": "foreground window", // optional
    "posture": {                                // optional; absent while idle
      "state": "sitting | peeking | dragging",
      "perched_on": {                           // sitting/peeking only; optional when identity is unavailable
        "app": "Visual Studio Code",            // primary app-owner identifier
        "window_title": "window the character is perched on" // secondary; optional
      }
    },
    "recent_apps": [                            // optional; apps switched to since the last utterance, oldest→newest
      { "name": "app name", "at": "ISO 8601 local time" }
    ]
  },
  "screenshot": {                               // optional; present when screen capture is enabled
    "enabled": true,
    "source": { "kind": "monitor", "index": 0 }, // ScreenSource union
    "width": 1920,
    "height": 1080
    // data_url is NOT included here — pixels arrive as the input_image content-part on input[1]
  },
  "trigger": {
    "kind": "user | schedule | proactive | agent | signals",
    "cue": {                                    // present for schedule and proactive kinds
      "label": "short human name",
      "context": "free-text intent the user wrote for the agent",
      "local_time": "HH:MM",                   // present for schedule
      "idle_min": 0                             // present for proactive (configured threshold, minutes)
    },
    "idle_elapsed_min": 0                       // present for proactive (actual elapsed minutes)
  }
}
```

`env.posture` reports the character's current physical posture on every turn. The field is absent while the character is idle. `state` is `"sitting"`, `"peeking"`, or `"dragging"`. Sitting and peeking may include `perched_on.app`, the primary and stable app-owner name, and `perched_on.window_title`, the secondary window title. Window titles are often unavailable without Screen Recording permission. `perched_on.app` is currently populated on macOS only; on Windows only `window_title` may appear. Either identity field may be omitted independently, and `perched_on` is omitted when both are unavailable. Dragging never includes `perched_on` because the cursor, rather than a window, holds the character.

`env.active_window_title` and `env.posture.perched_on.window_title` describe different windows. `active_window_title` is the currently focused OS window, while `perched_on.window_title` is the window supporting the character. They can differ when focus moves away from the perched window.

### `trigger.kind` values

| `kind` | What fired | User content | `cue` present |
|---|---|---|---|
| `user` | User spoke or typed | The user's message text | No |
| `schedule` | A user-configured time-of-day cue fired | Background marker | Yes |
| `proactive` | A configured engagement cue, tap-bored cue, or region-touch cue fired | Background marker | Yes |
| `agent` | An external coding-agent finish-hook posted a completion signal | Background marker | No (carries `agent` or `agent_catchup` instead) |
| `signals` | An external producer POSTed a burst to the `/signals` ingress | Background marker | No (carries `signals` instead) |

For `schedule`, `proactive`, `agent`, and `signals` turns there is no user utterance — the agent reads the trigger fields to decide whether and what to say. Firing a turn does not guarantee speech: the client renders whatever text the agent returns, and silence means the agent returns empty or no speech text. No client-side gate decides whether to speak (see `D-NO-SPEAK-GATE`).

### Background markers

When there is no user utterance, `input[1]` carries a short, per-`event_name` notice of what fired. The string rides in the user role, so it is written from the user's POV: "I" is the user, "you" is the agent. "You" is the on-screen VRM avatar — the agent's body — so window_sit/peek markers describe the user placing that body (drag & drop) and the agent's body ending up perched or peeking. It states what happened, never how to respond (firing ≠ judgment). The string is client-only framing so the agent has a concrete stimulus in the user turn; all situational detail still lives in `client_context.trigger`.

| `event_name` | Marker text |
|---|---|
| `proactive.tap_bored` | `(I keep poking at you)` |
| `proactive.touch_*` | `(I just poked you)` |
| `proactive.drag_held` | `(I keep dragging you around)` |
| `proactive.window_sit` | `(I just sat you down on a window's edge)` |
| `proactive.peek` | `(I left you peeking out from the screen edge)` |
| `proactive.*` (other) | `(I've gone quiet for a while)` |
| `schedule.*` | `(it's the time of day you check in on me)` |
| `agent.done` | `(one of my coding tasks just finished)` |
| `agent.catchup` | `(my coding tasks wrapped up while I was away)` |
| `signals.push` | `(a new signal just arrived for you)` |
| `signals.catchup` | `(signals piled up while I was away)` |
| any other | `(something just caught your attention)` |

### Cue fields

| Field | Type | Present for | Meaning |
|---|---|---|---|
| `label` | string | schedule, proactive | Short human-readable name the user gave this cue |
| `context` | string | schedule, proactive | Free-text intent the user wrote; the agent reads this to determine its response |
| `local_time` | string (`HH:MM`) | schedule | Configured clock time at which this cue fires |
| `idle_min` | number | idle proactive cues | Configured idle threshold in minutes; cue fires once this threshold is reached |
| `idle_elapsed_min` | number | idle proactive cues | Actual elapsed minutes since the last user interaction at the moment the cue fired |

### Per-kind examples

**`user` turn** — user typed or spoke:

```json
{
  "env": { "timestamp": "2026-06-15T19:30:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": { "kind": "user" }
}
```

**`schedule` turn** — time-of-day cue fired:

```json
{
  "env": { "timestamp": "2026-06-15T09:00:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": {
    "kind": "schedule",
    "cue": {
      "label": "morning call",
      "context": "Say good morning to user at 9 AM",
      "local_time": "09:00"
    }
  }
}
```

**`proactive` turn** — engagement cue fired after idle threshold:

```json
{
  "env": { "timestamp": "2026-06-15T14:45:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": {
    "kind": "proactive",
    "cue": {
      "label": "focus break reminder",
      "context": "remind user to take a break if they're focusing for too long",
      "idle_min": 30
    },
    "idle_elapsed_min": 37
  }
}
```

**`proactive.touch_*` turn** — the user tapped a configured body region (`touch_chest` or `touch_hips`). The turn carries that region's configured cue; a shared client-side cooldown limits how often touch turns fire:

```json
{
  "env": { "timestamp": "2026-06-15T15:10:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": {
    "kind": "proactive",
    "cue": {
      "label": "chest poked",
      "context": "The user just poked my chest. React in character — flustered, a little embarrassed. Keep it short."
    }
  }
}
```

**`proactive.drag_held` / `proactive.window_sit` / `proactive.peek` turns** — reflex reactions to a physical gesture (`configs/avatar.json` `gesture_cues`): a drag held past `drag_hold_ms`, the character settling onto a foreign window's top edge, or peeking from a screen edge. Each fires once per gesture occurrence — no repeat while sustained, no cooldown. These are REFLEX turns: the client skips the TTFT thinking filler since a deliberative pause before an immediate reaction feels wrong. `window_sit`/`peek` compose the sat-on/peeked-at window's name into `cue.context` at fire time when known:

```json
{
  "env": { "timestamp": "2026-06-15T15:12:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": {
    "kind": "proactive",
    "cue": {
      "label": "sat on window",
      "context": "I just sat down on the edge of a window — say something fitting. Keep it short. (currently perched on: Notes)"
    }
  }
}
```

### Agent completion fields

`agent` turns carry no `cue`. A turn is one of two shapes: a single completion observed while the user is present and the pipeline is idle (`agent`), or a burst of buffered completions flushed as one turn (`agent_catchup`). Completions buffer while the user is away or while the pipeline is busy (a backend call in flight or speech playback ongoing); the buffer flushes on the return-to-present or busy-to-idle edge. The source is an external coding-agent finish-hook that POSTs a completion signal to the running YUI app over loopback HTTP.

`trigger.agent` — single live completion:

| Field | Type | Meaning |
|---|---|---|
| `tool` | string | Coding agent that finished (e.g. `"claude-code"`, `"opencode"`) |
| `project` | string | Project name (typically the directory base name) |
| `cwd` | string | Absolute working directory at the time of completion |
| `status` | `"success" \| "error"` | Optional exit status reported by the hook |
| `summary` | string | Speech material from the hook (raw last message or pre-summarized; capped at 8192 bytes at ingress) |
| `ts` | number | Epoch millis when the hook fired |

`trigger.agent_catchup` — burst of buffered completions:

| Field | Type | Meaning |
|---|---|---|
| `count` | number | Total number of buffered completions in this burst |
| `items[]` | array | One entry per buffered completion, oldest first |
| `items[].tool` | string | Coding agent that finished |
| `items[].project` | string | Project name |
| `items[].status` | `"success" \| "error"` | Optional exit status |
| `items[].summary` | string | Speech material from the hook |
| `items[].ts` | number | Epoch millis when the hook fired |

### Agent examples

**`agent` turn** — live completion while the user is present:

```json
{
  "env": { "timestamp": "2026-06-15T16:20:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": {
    "kind": "agent",
    "agent": {
      "tool": "claude-code",
      "project": "yui",
      "cwd": "/Users/you/Desktop/codes/waifu/2026/YUI",
      "status": "success",
      "summary": "Extracted dev workflow into yui-dev-workflow skill and slimmed AGENTS.md.",
      "ts": 1781000000000
    }
  }
}
```

**`agent` turn** — catch-up burst flushed when the user returns:

```json
{
  "env": { "timestamp": "2026-06-15T17:05:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": {
    "kind": "agent",
    "agent_catchup": {
      "count": 2,
      "items": [
        { "tool": "claude-code", "project": "yui", "status": "success", "summary": "Fixed camera gaze head/eye tracking in the Tauri window.", "ts": 1781000000000 },
        { "tool": "opencode", "project": "api-server", "status": "error", "summary": "Build failed: type error in auth middleware.", "ts": 1781000600000 }
      ]
    }
  }
}
```

### Signals fields

`signals` turns carry no `cue`. A `proactive.tap_bored` turn carries its configured cue and may also carry drained buffered signals. The source is any external producer that POSTs `{ "signals": [...] }` to the YUI app's `/signals` ingress — n8n in the current deployment, though the client neither knows nor validates which one. While the user is present and the pipeline is idle, each POST becomes one turn. While the user is away or the pipeline is busy (a backend call in flight or speech playback ongoing), up to five POST batches are buffered; a sixth drops the oldest batch. On the return-to-present or busy-to-idle edge, all buffered items are flattened in arrival order into one `signals.catchup` turn. Items are heterogeneous — GitHub change, Notion task, heartbeat, or any future kind the producer decides to emit — with no uniform tag across them.

| Field | Type | Meaning |
|---|---|---|
| `signals[]` | array of opaque objects | The producer's signals, forwarded verbatim on `signals.*` turns or drained into `proactive.tap_bored`. No per-item shape is assumed or validated by the client; taxonomy is owned by the producer + the agent. |

### Signals example

**`signals` turn** — the producer POSTs a mixed burst:

```json
{
  "env": { "timestamp": "2026-06-15T16:20:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": {
    "kind": "signals",
    "signals": [
      { "source": "github", "repo": "acme/yui", "event": "push", "branch": "main" },
      { "source": "notion", "page_id": "abc123", "title": "Renew domain", "due": "2026-06-20" },
      { "source": "heartbeat", "ts": 1781000000000 }
    ]
  }
}
```

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
})
```

```json
{
  "emotion_id": "happy",
  "motion_id": "dance",
  "emotion_text": "🤭"
}
```

| Field | Use |
|---|---|
| `emotion_id` | facial expression |
| `motion_id` | body motion |
| `emotion_text` | voice tone tag |

All fields are optional. Include only the fields that should change.

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
generate_express({ emotion_id: "curious", motion_id: "calm", emotion_text: "😏" })
```

This means:

- say `"Hello User!"`;
- place a happy/dance/🤭 cue on that greeting;
- say `" How was your day?"`;
- place a curious/calm/😏 cue on the question.

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
- Only `generate_express` changes facial expression, body motion, or voice tone.

### What does `generate_express({})` mean?

It is an error. Do not call `generate_express` with no arguments.

To keep the sentence neutral, stream the text without calling `generate_express`.

## CC mode transport (Chat Completions)

In Chat Completions mode (`chat_api: "chat_completions"`) the same two-input
`client_context` + user layout above is sent as the CC `messages` array
instead of Responses `input[]`: a `system` message with the persona/global
instructions (if configured), a `system` message with `client_context: <JSON>`
(same shape as above), the trimmed conversation transcript, then the `user`
message.

`generate_express` arrives as `chat.completion.chunk` tool-call deltas
(`delta.tool_calls[].function.arguments`, accumulated per call index) instead
of `response.output_item.*` events, but the cue stays one-way in both
modes — the client declares no tool of its own, runs no client-side
tool-call round trip, and never returns a tool result for the call. The
backend agent behind the Chat Completions endpoint reads the broker via
`get_ids` exactly as a Responses-mode backend agent does, and is expected to
already know the `generate_express` contract (handed to it per
[the setup guide](../guide/getting-started.md#4-chat-protocol--backend-agent-responses-or-chat-completions))
rather than discovering it from a client-declared JSON-schema tool.
