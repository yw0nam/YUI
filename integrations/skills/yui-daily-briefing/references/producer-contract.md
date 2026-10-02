# Daily briefing producer contract

A producer of the daily briefing gathers its sources once per scheduled run and pipes one
JSON object into `scripts/briefing.py write`. The helper writes one markdown file per run
into a dated spool on the backend agent's machine. The agent lists the unspoken files with
`briefing.py pending`, speaks them, and records them with `briefing.py mark-spoken`. This
file states the input, the file the helper writes, the ledger, and the helper's commands.

## Gather input

```json
{
  "summary": "World news roundup: 2 items from 2 live feeds",
  "sources": [
    { "name": "example-wire", "status": "ok", "last_ok": "2026-10-02T04:05:21Z" },
    {
      "name": "example-feed",
      "status": "stale",
      "last_ok": "2026-09-28T22:10:00Z",
      "run_url": "https://scheduler.example.com/runs/231"
    }
  ],
  "refs": [
    {
      "kind": "news",
      "title": "Rates [update] rise again",
      "url": "https://news.example.com/story_(rates)",
      "at": "Thu, 01 Oct 2026 19:41:01 GMT",
      "excerpt": "Homebuilders and prospective buyers continue to face higher costs."
    }
  ]
}
```

`assets/fixtures/gather.json` holds this sample in full.

| Field | Cap |
|---|---|
| `summary` | Optional; one line, 200 characters; `<n> items` when absent, where `<n>` counts every distinct ref, including those the cap drops |
| `sources[]` | 10 entries |
| `sources[].name` | 40 characters, not empty |
| `sources[].status` | One of `ok`, `stale`, `failed`, `disabled` |
| `sources[].last_ok` | Timestamp, 64 characters, optional |
| `sources[].run_url` | `http` or `https` scheme, 2048 characters, optional |
| `refs[]` | 30 entries, newest first, one entry per distinct `url` |
| `refs[].kind` | Producer-defined label, 40 characters; `other` when absent |
| `refs[].title` | 200 characters; the `url` when absent |
| `refs[].url` | `http` or `https` scheme, 2048 characters |
| `refs[].at` | Timestamp, 64 characters; the moment of the run when absent |
| `refs[].excerpt` | 280 characters, possibly the empty string |

The gather script emits `refs` newest first; the helper keeps the first 30. A ref whose
`url` misses the `http` or `https` scheme, runs past 2048 characters, or holds a control
character drops out. Text fields collapse to one line, control characters, U+FFFE,
U+FFFF, and lone surrogates become spaces, and a field over its cap ends in `…`. A source with a `run_url`
outside the rule keeps its other fields.

## Briefing file

`write` names the file `<spool>/<YYYY-MM-DD>/<source>.md`, dated by the local day (the
job's `TZ`) at the moment stdin closes, and writes it through a temporary file and a
rename:

```markdown
---
source: "world-news"
date: "2026-10-02"
generated_at: "2026-10-02T08:20:03+02:00"
summary: "World news roundup: 2 items from 2 live feeds"
sources:
  - {name: "example-wire", status: "ok", last_ok: "2026-10-02T04:05:21Z"}
  - {name: "example-feed", status: "stale", last_ok: "2026-09-28T22:10:00Z", run_url: "https://scheduler.example.com/runs/231"}
---

# World news roundup: 2 items from 2 live feeds

1. [Rates \[update\] rise again](<https://news.example.com/story_(rates)>)
   news · Thu, 01 Oct 2026 19:41:01 GMT
   Homebuilders and prospective buyers continue to face higher costs.
```

1. The front matter is YAML. Every string value is a JSON-encoded double-quoted string.
   `sources` holds one flow mapping per source, or reads `sources: []`.
2. The body opens with the summary as a heading, then one numbered item per ref: a link
   line, a `kind · at` line, and an excerpt line when the excerpt carries text.
3. A title escapes `[`, `]`, and `\`. A url sits inside `<…>`, with whitespace, `<`,
   `>`, and `\` percent-encoded.

Each source has at most one unspoken briefing per day. A run replaces it, whether it is
`<source>.md` or a stamped file. When every briefing of that source and day is spoken, the
run writes `<source>.<HHMMSSffffff>.md` beside them, stamped with the local time of the run
to the microsecond. A spoken file stays as written, with one exception: a `write` that
finds the ledger unreadable reads every file as unspoken. Only `write` creates or replaces
briefing files.

## Ledger

`<spool>/spoken.json` is a JSON object that maps each spoken file's path, relative to the
spool (`2026-10-02/world-news.md`), to the local ISO-8601 time `mark-spoken` recorded it.
`write` and `mark-spoken` hold an exclusive lock on `<spool>/.lock` while they read and
write it, and the ledger is written through a temporary file and a rename. `pending`
reads it unlocked. `mark-spoken` renames an unreadable ledger `spoken.json.bad` with one
line on stderr and reads it as empty. `write` and `pending` read an unreadable ledger as
empty with one line on stderr and leave it in place.

The ledger keys paths, so a run that replaces an unspoken briefing between the agent's
`pending` and `mark-spoken` is recorded as spoken with text the agent never read; the
contract accepts that gap.

The helper creates files and folders readable by their owner only, so producers run as
the same OS user as the agent.

## Commands

| Flag | Default |
|---|---|
| `--spool <dir>` | `$YUI_BRIEFING_SPOOL`; required when that variable is unset or empty. An absolute path; `pending` and `mark-spoken` need the directory to exist, `write` creates it. It goes before the subcommand |

| Command | Does |
|---|---|
| `write --source <name>` | Reads the gather input on stdin and writes the briefing file. `<name>` is 1 to 40 letters, digits, `_`, or `-` |
| `pending` | Prints every `<YYYY-MM-DD>/<file>.md` file missing from the ledger, oldest day first, then by file name, each under a line `=== <path relative to the spool> ===`, with bytes that are not UTF-8 shown as U+FFFD. Prints nothing when every file is spoken |
| `mark-spoken PATH...` | Records each path in the ledger. Each path reads `<YYYY-MM-DD>/<file>.md`, exactly as `pending` prints it, and names an existing file |

| Exit | Output | Meaning |
|---|---|---|
| 0 | none from `write` and `mark-spoken`; the briefings from `pending` | Done |
| 1 | the reason on stderr | `write` read malformed input; the error path below applies |
| 2 | the reason on stderr | No spool (`set YUI_BRIEFING_SPOOL or pass --spool`), a relative spool path, a missing spool directory for `pending` or `mark-spoken`, a `--source` outside the rule, a `mark-spoken` path that is absolute, holds `..`, or names no briefing in the spool (nothing is recorded), or an unknown flag |

## Run time

A producer fires at a fixed local time ahead of the user's usual first activity. YUI sends
`trigger: milestone first_activity` once per local day, on the first tick that finds the
user present with the "Scheduled greeting" switch on, and the agent speaks what `pending`
prints on that turn. A day with several producers yields one file per producer.

A quiet day still gets its run. Its file carries no items, and a briefing whose sources
all read `ok` adds nothing to say.

## Source health

`sources[]` holds one entry per source the producer reads, each carrying the status that
the source's own rule yields:

| Status | Meaning |
|---|---|
| `ok` | The source answered inside its freshness window |
| `stale` | The source last answered at `last_ok`, further back than that window |
| `failed` | The last read raised an error |
| `disabled` | The source is switched off on this machine |

`run_url` points at the execution or delivery record behind the observation.

## Error path

Input that fails to parse or breaks the shape above makes `write` write a failed briefing
under the producer's name: `summary` reads `<source> run failed: <error type>: <message>`,
`sources` holds one entry named after the producer with `status: "failed"`, and the body
holds no items. When an unspoken briefing of the same source and day exists, `write` keeps
it and writes nothing. Either way it prints the reason on one stderr line and
exits 1, which leaves the failure in the scheduler's own record.
