# Backend Agent ↔ Broker Interaction

## Per-turn client context (client → agent)

Each turn the client sends a Responses API request with two inputs followed by `instructions` (static persona/global rules, config-driven). The inputs are:

| Index | Role | Content |
|---|---|---|
| `input[0]` | `system` | `client_context: <JSON>` — current context (no user utterance) |
| `input[1]` | `user` | The user's message text, or a proactive marker when no user utterance exists |

When a screenshot is attached, `input[1]` is a content-part array: `[{ type: "input_text", text }, { type: "input_image", image_url }]`. Otherwise it is plain text.

### `client_context` JSON shape

```jsonc
{
  "env": {
    "timestamp": "ISO 8601 local time with offset", // e.g. "2026-06-15T19:30:00+09:00"
    "timezone": "IANA zone (auto-detected)",    // e.g. "Asia/Seoul"
    "active_app": { "name": "foreground app" }, // optional
    "active_window_title": "foreground window"  // optional
  },
  "screenshot": {                               // optional; present when screen capture is enabled
    "enabled": true,
    "source": { "kind": "monitor", "index": 0 }, // ScreenSource union
    "width": 1920,
    "height": 1080
    // data_url is NOT included here — pixels arrive as the input_image content-part on input[1]
  },
  "trigger": {
    "kind": "user | schedule | proactive | github",
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

### `trigger.kind` values

| `kind` | What fired | User content | `cue` present |
|---|---|---|---|
| `user` | User spoke or typed | The user's message text | No |
| `schedule` | A user-configured time-of-day cue fired | Proactive marker string | Yes |
| `proactive` | A user-configured engagement cue fired because the user has been present but not interacting | Proactive marker string | Yes |
| `github` | A watched GitHub PR changed CI or review state | Proactive marker string | No (carries `pr` or `pr_catchup` instead) |

For `schedule`, `proactive`, and `github` turns there is no user utterance — the agent reads the trigger fields to decide whether and what to say. Firing a turn does not guarantee speech: the client renders whatever text the agent returns, and silence means the agent returns empty or no speech text. No client-side gate decides whether to speak (see `D-NO-SPEAK-GATE`).

### Cue fields

| Field | Type | Present for | Meaning |
|---|---|---|---|
| `label` | string | schedule, proactive | Short human-readable name the user gave this cue |
| `context` | string | schedule, proactive | Free-text intent the user wrote; the agent reads this to determine its response |
| `local_time` | string (`HH:MM`) | schedule | Configured clock time at which this cue fires |
| `idle_min` | number | proactive | Configured idle threshold in minutes; cue fires once this threshold is reached |
| `idle_elapsed_min` | number | proactive | Actual elapsed minutes since the last user interaction at the moment the cue fired |

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

### GitHub PR fields

`github` turns carry no `cue`. A turn is one of two shapes: a single live transition observed while the user is present (`pr`), or a burst of transitions buffered while the user was away and flushed on return (`pr_catchup`). The watcher fires only on CI failure (`FAILURE`/`ERROR`) and review decisions (`CHANGES_REQUESTED`/`APPROVED`); other states update internal tracking without firing.

`trigger.pr` — single live PR transition:

| Field | Type | Meaning |
|---|---|---|
| `repo` | string | `owner/name` of the repository |
| `number` | number | PR number |
| `title` | string | PR title |
| `url` | string | PR web URL |
| `event` | `"ci_failed" \| "review_changes" \| "review_approved"` | Which transition fired |
| `from` | string \| null | Previous field value (`null` if unseen) |
| `to` | string | New field value that triggered the event |

`trigger.pr_catchup` — burst of buffered transitions, grouped per still-open PR:

| Field | Type | Meaning |
|---|---|---|
| `prs[]` | array | One entry per PR with buffered transitions |
| `prs[].repo` | string | `owner/name` of the repository |
| `prs[].number` | number | PR number |
| `prs[].title` | string | PR title |
| `prs[].url` | string | PR web URL |
| `prs[].transitions[]` | array | Buffered transitions for this PR, oldest first |
| `prs[].transitions[].kind` | `"ci" \| "review"` | Which field changed |
| `prs[].transitions[].from` | string \| null | Previous value (`null` if unseen) |
| `prs[].transitions[].to` | string | New value |
| `prs[].transitions[].ts` | number | Epoch millis when the transition was observed |

### GitHub examples

**`github` turn** — live CI failure while the user is present:

```json
{
  "env": { "timestamp": "2026-06-15T16:20:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": {
    "kind": "github",
    "pr": {
      "repo": "acme/yui",
      "number": 263,
      "title": "feat: github pr watcher",
      "url": "https://github.com/acme/yui/pull/263",
      "event": "ci_failed",
      "from": "SUCCESS",
      "to": "FAILURE"
    }
  }
}
```

**`github` turn** — catch-up burst flushed when the user returns:

```json
{
  "env": { "timestamp": "2026-06-15T17:05:00+09:00", "timezone": "Asia/Seoul" },
  "trigger": {
    "kind": "github",
    "pr_catchup": {
      "prs": [
        {
          "repo": "acme/yui",
          "number": 263,
          "title": "feat: github pr watcher",
          "url": "https://github.com/acme/yui/pull/263",
          "transitions": [
            { "kind": "ci", "from": "SUCCESS", "to": "FAILURE", "ts": 1781000000000 },
            { "kind": "review", "from": null, "to": "APPROVED", "ts": 1781000600000 }
          ]
        }
      ]
    }
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
