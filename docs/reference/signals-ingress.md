# Signals ingress

External producers send signal groups to the loopback HTTP ingress with `POST /signals`.
The request body always contains a `signals` array and may contain a delivery envelope:

```json
{
  "signals": [{ "kind": "workflow", "status": "complete" }],
  "envelope": {
    "source": "n8n",
    "event_type": "workflow_done",
    "delivery": "batched",
    "event_id": "run-8812",
    "occurred_at": 1787449000000
  }
}
```

Signal items are opaque JSON objects. The client transports and renders them without
interpreting their meaning.

## Envelope fields

| Field | Valid value |
|---|---|
| `source` | Non-empty string identifying the producer |
| `event_type` | Non-empty string identifying the producer-defined event type |
| `delivery` | Exactly `"immediate"` or `"batched"` |
| `event_id` | Non-empty opaque string; duplicate values remain separate groups |
| `occurred_at` | Finite epoch-millisecond number in the inclusive range `-8.64e15` through `8.64e15`, representable as an ISO-8601 date |

An absent envelope and an explicit `"envelope": null` are equivalent. Both requests
use legacy delivery and produce no envelope warning.

## Delivery

An `immediate` group fires at once while the user is present and the pipeline is idle.
Otherwise it waits in the away buffer. A legacy group follows the same behavior.

A `batched` group always waits in the batch buffer. The first group starts a five-minute
delivery interval. At the interval boundary, all pending batched groups fire together
when signals are enabled, the user is present, and the pipeline is idle. If those
conditions are not met, the groups remain buffered without another timer.

While signals are disabled, the client drops every group that arrives, and the next
OS idle tick clears the groups already buffered.

Returning to present or transitioning from busy to idle emits one catch-up containing
both away-buffered and batched groups in their original arrival order. Returning before
a batched group's deadline therefore includes it in that catch-up.

Two client-fired turns also drain the buffers and carry the groups themselves: a
`proactive.tap_bored` turn and the `time_milestone.first_activity` turn. Both take
every pending group in arrival order, and a drain empties the away buffer and the
batch buffer together.

Each buffer retains at most five groups and drops its oldest group on overflow.

## Daily briefing items

The client keeps every signal item opaque. A producer of the daily briefing builds one item
per scheduled run, one run per local day, keeps it in a dated spool until the ingress
answers 2xx, and posts every pending item packed into as few groups as the body cap allows,
oldest day first. Each item has this shape:

```json
{
  "skill": "yui-daily-briefing",
  "date": "2026-09-11",
  "summary": "3 pull requests, 1 issue, 2 mails since 2026-09-10 18:00",
  "sources": [
    { "name": "repo-status", "status": "ok", "last_ok": "2026-09-11T06:00:00+09:00" },
    { "name": "gmail", "status": "stale", "last_ok": "2026-09-09T22:10:00+09:00" }
  ],
  "refs": [
    {
      "kind": "pull_request",
      "title": "feat: open speech-bubble links in the default browser",
      "url": "https://github.com/yw0nam/YUI/pull/887",
      "at": "2026-09-11T05:24:26Z",
      "excerpt": ""
    }
  ]
}
```

| Field | Rule |
|---|---|
| `skill` | Name of the skill the backend loads for the item |
| `date` | Local day of the run that built the item, `YYYY-MM-DD` |
| `summary` | One line, at most 200 characters |
| `sources[]` | One entry per source the producer reads, at most 10 entries |
| `sources[].name` | At most 40 characters |
| `sources[].status` | One of `ok`, `stale`, `failed`, `disabled` |
| `sources[].last_ok` | ISO-8601 timestamp, or absent |
| `sources[].run_url` | `http` or `https`, at most 2048 characters, or absent |
| `refs[]` | At most 30 entries, newest first, one entry per distinct `url` |
| `refs[].kind` | Producer-defined label, at most 40 characters |
| `refs[].title` | At most 200 characters |
| `refs[].url` | `http` or `https`, at most 2048 characters |
| `refs[].at` | ISO-8601 timestamp |
| `refs[].excerpt` | At most 280 characters, possibly the empty string |

The serialized request runs to at most 49,152 bytes of UTF-8. The producer measures each
item alone in a request and drops its oldest refs until that request fits the cap; a group
holds as many items as fit under it.

An item whose `refs` is `[]` says that run brought nothing new. A day with no item means
the producer skipped its run.

The group travels under this envelope:

| Field | Value |
|---|---|
| `source` | Name of the producer run that posted the group; each item's `sources[]` names what it reports on |
| `event_type` | `daily_briefing` |
| `delivery` | `immediate` |
| `event_id` | `daily-briefing:<newest date among the group's items>` |
| `occurred_at` | Epoch milliseconds |

The client delivers every group it receives. Each group becomes its own turn when it
arrives while the user is present and the pipeline is idle; groups that wait in a buffer
share the next turn that drains the buffers. Packing the pending items into few groups
keeps several days of pending items inside the away buffer's five-group cap.

A run that raises yields an item of the same shape, naming the producer in its own
`sources[]` entry:

```json
{
  "skill": "yui-daily-briefing",
  "date": "2026-09-14",
  "summary": "cron run failed: ValueError: stdin must hold a JSON object with sources[] and refs[]",
  "sources": [
    {
      "name": "cron",
      "status": "failed",
      "run_url": "https://scheduler.example.com/runs/231"
    }
  ],
  "refs": []
}
```

The `run_url` entry is present when the scheduler has a run page; the bundled
`post-briefing.py` error path writes the failed source with `name` and `status` only.

### Health observations

| Observation | Where it shows |
|---|---|
| Collection failure | `sources[].status` reads `failed` |
| No data | An item with `refs: []` whose sources all read `ok` |
| Stale data | `sources[].status` reads `stale`, with `last_ok` |
| Intentional inactivity | `sources[].status` reads `disabled` |
| Run that raised | An item from the producer's error path whose single source, named after the producer, reads `failed`, carrying `run_url` when the scheduler has a run page |
| Missed run (the producer never fired: automation down or the workflow unpublished) | No item for that producer and day; nothing posts on the producer's behalf |
| Receiver offline | The ingress refuses the connection, or a tunnel with no listener behind it hangs up; the producer keeps its items pending and the next flush that reaches the ingress carries them |
| Delivery acceptance | HTTP 2xx from the ingress; the producer marks the group's items sent |
| Duplicate delivery | Every item the ingress accepts renders as its own `signal [...]` line; groups that wait in a buffer together arrive in one catch-up turn, and groups that each find the pipeline idle arrive in one turn apiece |
| Backend handling | One line in `logs/turns_<date>.jsonl` carrying the group |
| Completed output | The `[backend-caller] speech` line in the app log |
| Interrupted playback | The following turn's `previous:` line reads `interrupted` (see `docs/reference/client-context.md`) |

The client records none of these judgments: it transports the group, writes the turn
line, and speaks whatever text returns.

## Validation and legacy behavior

The HTTP ingress requires `POST /signals`, valid JSON, and a `signals` array. A request
with another method on `/signals` receives HTTP 405. Invalid JSON or a missing `signals`
array receives HTTP 400. It forwards a present, non-null envelope without validating
or rewriting it and stamps the emitted batch with server time.

The signal source validates the envelope fields. An invalid envelope is discarded and
the group follows legacy delivery. Its signal items are still delivered, and one warning
is logged for the downgraded batch. There is no fallback timestamp and no event-id
deduplication.

A legacy request is:

```json
{
  "signals": [{ "source": "heartbeat", "healthy": true }]
}
```
