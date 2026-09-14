# Daily briefing producer contract

A producer of the daily briefing posts one signal group per scheduled run to YUI's
`POST /signals` ingress. This file states everything the request has to satisfy.

## Request

The body is JSON: a `signals` array holding one item, and an `envelope`.

```json
{
  "signals": [
    {
      "skill": "yui-daily-briefing",
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
  ],
  "envelope": {
    "source": "n8n",
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
| `refs[]` | 30 entries, newest first, one entry per distinct `url` |
| `refs[].title` | 200 characters |
| `refs[].url` | `http` or `https` scheme, 2048 characters |
| `refs[].excerpt` | 280 characters, possibly the empty string |
| `sources[].run_url` | `http` or `https` scheme, 2048 characters, optional |
| Whole body | At most 49,152 bytes of UTF-8 |

`refs[].kind` reads `pull_request`, `issue`, `mail`, or `other`. `refs[].at` is an
ISO-8601 timestamp. The producer measures the serialized body and drops its oldest refs
until the body fits that cap.

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

A run that raises posts a group of the same item shape from the producer's error
workflow, carrying one `sources[]` entry named after the failed workflow, `status:
"failed"`, `run_url` set to the failed execution, `last_ok` absent, and `refs: []`. The
envelope reads `event_type: "source_health"` and `event_id:
"source-health:<workflow id>:<execution id>"`, where the execution slot reads the epoch
milliseconds of the failure in place of an execution id when the failure struck before an
execution record existed (a trigger-time failure). The error workflow is wired through
the producer workflow's Settings → Error Workflow, and it fires only for a run that
raised — a refused ingress connection is not an error, since that run ends on the pending
branch.

## Retry

The producer marks its rows sent once the ingress answers 2xx. A refused connection
leaves every row pending, and the following run picks them up again.

## Reference mapping from `signal_queue` rows

The reference producer reads the pending rows of an n8n `signal_queue` data table
(columns `key`, `source`, `priority`, `payload`, `status`, `sent_at`, plus the `id` and
`createdAt` that n8n adds) newest first, and maps each row to one ref:

| Ref field | Value taken from the row |
|---|---|
| `kind` | `payload.source`: `github_pr` → `pull_request`, `github_issue` → `issue`, `gmail` → `mail`, anything else → `other` |
| `title` | `payload.title`, else `payload.subject`, else the row's `key` |
| `url` | `payload.url`, or for gmail `https://mail.google.com/mail/#inbox/<thread_id>` |
| `at` | `payload.updated_at`, else `payload.date`, else the row's `createdAt` |
| `excerpt` | `payload.snippet` |

Collectors write one row per update, so a single url reaches several pending rows. The
newest row of a url wins and the older ones drop out of `refs`.

A row whose url misses the `http` or `https` scheme, and a row whose url runs past 2048
characters, each count toward `summary` and stay out of `refs`. Every pending row the run
read gets marked sent, including the ones that reached `summary` alone.
