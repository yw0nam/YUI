# Daily briefing producer contract

A producer of the daily briefing posts one signal group per scheduled run to YUI's
`POST /signals` ingress. This file states everything the request has to satisfy. The
reference producer is `scripts/post-briefing.py`, and the envelope's `source` field names
whichever producer posted the group.

## Request

The body is JSON: a `signals` array holding one item, and an `envelope`.

```json
{
  "signals": [
    {
      "skill": "yui-daily-briefing",
      "summary": "1 paper, 1 pull request since 2026-09-10 18:00",
      "sources": [
        { "name": "arxiv", "status": "ok", "last_ok": "2026-09-11T06:00:00+09:00" },
        { "name": "repo-status", "status": "stale", "last_ok": "2026-09-09T22:10:00+09:00" }
      ],
      "refs": [
        {
          "kind": "paper",
          "title": "Diffusion policies for dexterous manipulation",
          "url": "https://arxiv.org/abs/2609.01234",
          "at": "2026-09-11T05:24:26Z",
          "excerpt": "One policy learns twelve tasks from forty demonstrations."
        },
        {
          "kind": "pull_request",
          "title": "feat: open speech-bubble links in the default browser",
          "url": "https://github.com/yw0nam/YUI/pull/887",
          "at": "2026-09-11T04:02:00Z",
          "excerpt": ""
        }
      ]
    }
  ],
  "envelope": {
    "source": "cron",
    "event_type": "daily_briefing",
    "delivery": "immediate",
    "event_id": "daily-briefing:2026-09-11",
    "occurred_at": 1789077600000
  }
}
```

## Caps

| Field | Cap |
|---|---|
| `summary` | One line, 200 characters |
| `sources[]` | 10 entries |
| `sources[].name` | 40 characters |
| `sources[].run_url` | `http` or `https` scheme, 2048 characters, optional |
| `refs[]` | 30 entries, newest first, one entry per distinct `url` |
| `refs[].kind` | Producer-defined label, at most 40 characters |
| `refs[].title` | 200 characters |
| `refs[].url` | `http` or `https` scheme, 2048 characters |
| `refs[].excerpt` | 280 characters, possibly the empty string |
| Whole body | At most 49,152 bytes of UTF-8 |

`refs[].at` is an ISO-8601 timestamp. The producer measures the serialized body and drops
its oldest refs until the body fits that cap.

## Reference producer

`scripts/post-briefing.py` applies every cap above, wraps the item in the envelope, and
posts it. A producer script gathers its sources, prints one JSON object on stdout, and
pipes it in:

```json
{ "summary": "…", "sources": [ … ], "refs": [ … ] }
```

The gather script emits `refs` newest first; the poster keeps the first 30 and drops from the
tail when the body runs over the size cap. `summary` is optional and reads `<n> items` when it
is absent. A ref whose `url` misses
the `http` or `https` scheme or runs past 2048 characters drops out; `kind` defaults to
`other`, `title` to the `url`, `at` to the moment of the run.

| Flag | Default |
|---|---|
| `--url` | `$YUI_SIGNALS_URL`, else YUI's loopback listener on its default port |
| `--source` | `cron` |
| `--event-id` | `daily-briefing:<local YYYY-MM-DD>` |
| `--dry-run` | Prints the request body and posts nothing |

| Exit | Output | Meaning |
|---|---|---|
| 0 | none | The ingress accepted the group |
| 0 | `yui unreachable` on stderr | The ingress refused the connection or never answered |
| 1 | `yui answered <code>` on stderr | The ingress answered outside 2xx |
| 1 | the reason on stderr | The input was malformed; the error path below posted, unless `--dry-run` |

## Run time

The producer fires at a fixed local time ahead of the user's usual first activity, once
per local day. `envelope.event_id` reads `daily-briefing:<YYYY-MM-DD>` for that day.

The client delivers every group it receives, so a manual re-run makes YUI speak a second
time on the same day.

A quiet day still gets its run. The group then carries `refs: []`. The backend keeps the
turn silent when every source reads `ok`, and otherwise speaks the health sentence alone.

## Source health

`sources[]` holds one entry per source the producer reads, each carrying the status that
the source's own rule yields:

| Status | Meaning |
|---|---|
| `ok` | The source answered inside its freshness window |
| `stale` | The source last answered at `last_ok`, further back than that window |
| `failed` | The last read raised an error |
| `disabled` | The source is switched off on this machine |

`last_ok` is an ISO-8601 timestamp and may be absent. `run_url` points at the execution
or delivery record behind the observation and may be absent.

## Error path

A run that raises posts a group of the same item shape, carrying one `sources[]` entry
named after the producer, `status: "failed"`, `last_ok` absent, and `refs: []`. The
envelope reads `event_type: "source_health"` and `event_id:
"source-health:<producer>:<run id>"`, where the run id is the scheduler's execution id, or
the epoch milliseconds of the failure when the scheduler keeps no run record. `run_url`
points at the failed run when the scheduler has a page for it. A refused ingress
connection is no such failure and posts nothing.

## Retry

A refused connection skips that morning: the producer exits 0 and queues nothing, so the
following run carries what that run gathers and no backlog. An answer outside 2xx exits 1,
which leaves the failure in the scheduler's own record.
