# Daily briefing producer contract

A producer of the daily briefing builds one briefing item per scheduled run and posts it to
YUI's `POST /signals` ingress. This file states everything the request has to satisfy. The
reference producer is `scripts/post-briefing.py`. The envelope's `source` field names the
run that posted the group; each item's own `sources[]` names what it reports on.

## Request

The body is JSON: a `signals` array holding one or more briefing items, oldest day first,
and an `envelope`. Each item comes from one producer run.

```json
{
  "signals": [
    {
      "skill": "yui-daily-briefing",
      "date": "2026-09-11",
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
| `date` | The local day of the run, `YYYY-MM-DD` |
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

`refs[].at` is an ISO-8601 timestamp. The producer measures each item serialized alone in a
request and drops its oldest refs until that request fits the body cap. A request carrying
several items drops refs from the oldest item first, then the next oldest, until it fits;
every item keeps its `date`, `summary`, and `sources`.

## Reference producer

`scripts/post-briefing.py` keeps every run in a spool directory, split by day, and posts what
is pending whenever YUI answers. A producer script gathers its sources, prints one JSON
object on stdout, and pipes it in:

```json
{ "summary": "…", "sources": [ … ], "refs": [ … ] }
```

The gather script emits `refs` newest first; the poster keeps the first 30 and drops from the
tail when the item runs over the size cap. `summary` is optional and reads `<n> items` when it
is absent, where `<n>` counts every distinct ref, including those the cap drops. A ref whose `url` misses
the `http` or `https` scheme or runs past 2048 characters drops out; `kind` defaults to
`other`, `title` to the `url`, `at` to the moment of the run.

A run goes through three steps:

① Compose the item with every cap above and `date` set to the local day.

② Write it to `<spool>/<YYYY-MM-DD>/<source>.json`. A second run of the same source on the
same day overwrites that file and leaves it pending.

③ Flush the spool.

A flush takes an exclusive lock on `<spool>/.lock`, collects every pending
`<YYYY-MM-DD>/<source>.json` oldest day first, and posts them as one request. YUI's away
buffer keeps the five newest groups, so one group per flush keeps a backlog of several days
from pushing older groups out. When the items run over the body cap, the posted copy drops
refs from the oldest item first, then the next oldest; the spool files keep their full refs.
The newest items that still run over the cap with every ref dropped wait for the next flush.
The envelope reads `event_id: "daily-briefing:<newest date in the request>"`. A 2xx answer
renames every file in the request to `<source>.<HHMMSSmmm>.sent.json`, stamped with the
local delivery time, so the dated directories keep every delivered item, including each
delivery of a source that ran again on the same day. A refused connection, reset, hang-up,
or timeout leaves the files pending. A file that holds no briefing item is renamed
`<source>.json.bad` with one line on stderr, and the flush goes on without it. `--flush`
runs that step alone, so a scheduler that calls it every few minutes delivers the spool
within minutes of YUI becoming reachable. A `--flush` prints nothing while YUI is
unreachable and exits 0 at once when it finds the lock held; a run from stdin waits for the
lock. The poster creates files readable by their owner only.

| Flag | Default |
|---|---|
| `--url` | `$YUI_SIGNALS_URL`, else YUI's loopback listener on its default port |
| `--source` | `cron`; 1 to 40 letters, digits, `_`, or `-`; names the spool file and the envelope `source` of the request the run posts |
| `--spool` | `$YUI_BRIEFING_SPOOL`, else `~/.local/state/yui-daily-briefing/spool` |
| `--flush` | Flushes the spool without reading stdin |
| `--dry-run` | Prints the request body the flush would post, the stdin item included, and writes and posts nothing |

| Exit | Output | Meaning |
|---|---|---|
| 0 | none | Every pending item was delivered, another flush holds the lock, or a `--flush` found the ingress unreachable |
| 0 | `yui unreachable` on stderr | A run from stdin found the ingress refusing the connection, hanging up, or timing out; the items stay pending |
| 1 | `yui answered <code>` on stderr | The ingress answered outside 2xx; the items stay pending |
| 1 | the reason on stderr | The input was malformed; the error path below applies, and nothing is written under `--dry-run` |
| 2 | usage on stderr | An unknown flag or a `--source` outside the rule above |

## Run time

The producer fires at a fixed local time ahead of the user's usual first activity, once
per local day. Its item's `date` reads that day.

The client delivers every group it receives, so a manual re-run makes YUI speak a second
time on the same day.

A quiet day still gets its run. The item then carries `refs: []`. The backend keeps the
turn silent when every item has empty `refs` and every source reads `ok`, and otherwise
speaks the health sentence alone.

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

A run that raises spools a failed item under the producer's name: `summary` reads
`<producer> run failed: <error>`, `sources[]` holds one entry named after the producer with
`status: "failed"` and `last_ok` absent, and `refs` is `[]`. It travels like any other item.
`run_url` points at the failed run when the scheduler has a page for it; the reference
producer writes `name` and `status` only. When a valid pending item from an earlier run of
the same source and day sits in the spool, the reference producer keeps it, writes no failed
item, prints the reason, and exits 1. A refused ingress connection leaves the spool as it is.

## Retry

A producer keeps every item until the ingress answers 2xx, so the user hears what earlier
mornings missed on the next delivery, each item under its own `date`.

A refused connection exits 0, since YUI being closed at run time is an ordinary morning.
An answer outside 2xx exits 1, which leaves the failure in the scheduler's own record.

A 2xx means YUI's ingress accepted the group; a client with signals switched off drops it.

A producer that reads its sources from a queue of rows keeps those rows pending and marks
them sent on a 2xx answer.
