# yui-desire

`yui-desire` is the Hermes-side desire system for an autonomous agent. Its `llm_request` middleware injects a
`<desire_state>` block into the newest user message of every request; a pre-run gate script does the state
bookkeeping on a schedule and wakes a Hermes cron turn in two cases; a helper records what happened to the agent,
how it took it, and what it holds. Wants, judgment, and speech decisions remain in Hermes; YUI receives desire
speech through its existing `/signals` ingress.

The integration is a self-contained Python 3.10+ uv project. Runtime code uses only the Python standard library.

## What a backend needs

1. A scheduler that runs a script before an agent job and skips the agent when the script's last stdout line is
   `{"wakeAgent": false}` or its stdout is empty (Hermes: a cron job with `--script`).
2. A hook that adds text to each model request (Hermes: the `llm_request` middleware).
3. A shell the agent can run the helper in, with the profile's `DESIRE_*` values exported.
4. A state directory that persists between turns.
5. A long-term memory the agent can read, for the weekly reflection.

## Identity

`DESIRE_AGENT_NAME` names the agent, one short lowercase slug, and every convention derives from it: the
branch prefix `<agent>/`, the issue marker `<!-- from-<agent> -->`, the issue label `from-<agent>`, the
signal source `<agent>-desire`, and the cron job names `<agent>-desire-tick`, `<agent>-desire-reflection`, and
`<agent>-desire-report`. `DESIRE_CHAT_PLATFORMS` names the channels the user speaks to the agent on. Both are
required and have no default: the gate and the helper stop with an error naming the missing variable, and the
middleware injects nothing and logs one. The desire block opens with the line `agent: <agent>` so the prompts can
refer to it.

## State

State lives in `DESIRE_STATE_DIR` when set. Otherwise it resolves to `desire/` under the Hermes profile
directory the turn or job runs in. When `HERMES_PROFILE` is set and `~/.hermes/profiles/$HERMES_PROFILE/desire/`
exists as a different directory, the plugin logs one warning naming both paths.

The state directory contains:

- `events.jsonl`, append-only. An event is `{"id": "e-<6 hex>", "at", "fact", "source": "agent"|"monitor",
  "source_ref"}`: a fact is what was observed, `source` says who filed it, and `source_ref` is the URL or path it
  came from, or `null`. A correction is `{"corrects": "<event id>", "at", "fact"}` and a retraction is
  `{"retracts": "<event id>", "at", "why"}`; both name the event and leave its line as written. The latest
  correction is the fact shown, and a retracted event is shown nowhere.
- `readings.jsonl`, append-only. `{"id": "r-<6 hex>", "event_id", "at", "text"}`: how the agent took an event,
  in its words. The latest reading of an event is the one shown. An event the gate filed starts without one.
- `judgments.jsonl`, append-only. `{"at", "name", "toward": "user"|"self"|"world", "level": "faint"|"some"|
  "strong"|"very strong"|null, "events": [<event id>, ...], "why"}`. The latest line for a `(name, toward)` is
  the present judgment; a line with `level: null` puts the pair down and carries no events. No code compares two
  levels, combines two judgments, or moves a judgment with time.
- `feelings.json`, the registry of names: `{"names": [...]}`. A fresh install seeds 26 names (closeness, trust,
  doubt, longing, ease, expectation, hope, curiosity, absorption, traction, pride, sense of choosing, surprise,
  amusement, loneliness, hurt, disappointment, frustration, wavering, tiredness, wariness, anger, jealousy,
  resentment, contempt, shame). The helper rejects a level judgment on a name outside the registry and prints the
  registry; a put-down works for any name with a present judgment.
- `how.md`, free text of at most 500 characters, written by `act.py how` and shown back as written.
- `drives.json`, the interaction and signal stamps: `last_interaction_at`, `last_interaction_hash`,
  `last_signal_at` (the last delivered signal), and `last_signal_answered_at` (the first user turn after it).
  The interaction time starts at bootstrap time; the hash and both signal stamps start as `null`.
- `wants.md`, the agent's own prose record of its open wants, progress, feedback, and completed or abandoned
  wants. Integration code never parses this file.
- `outbox.jsonl`, held notes blocked by a daily budget or a signal-delivery error. An item persists here, and in
  the pent-up section of the desire block, until it is delivered (`act.py outbox --send`), released
  (`act.py outbox --release`), or expires 48 hours after `created_at`. Each item carries `attempts`, the number of
  failed deliveries, and `last_failed_at`. A postponed item also carries `not_before`, the time it becomes visible
  again; it keeps ageing toward the same expiry while it is hidden.
- `transport.json`, whether the YUI signals ingress is reachable: `state` (`up` or `down`), `since` (when the
  current state began), `failed` (consecutive failures, zero while up), `last_checked_at`, and `source`, which
  names what last wrote the record: `probe` for the gate, `delivery` for a signal delivery, `user-turn` for a user
  message that reached Hermes through YUI. The gate refreshes it every run with an HTTP GET to
  `YUI_SIGNALS_URL`, treating any HTTP response as reachable, and every signal delivery outcome updates it too.
- `budget.json`, KST daily counters for signals, issues, self-initiated comments, and pull requests, plus pending
  issue, comment, and pull-request reservations. Fresh counters are zero and `pending` is empty.
- `artefacts.json`, what the gate has seen on GitHub: `bootstrapped_at`, `bootstrapped` (the sources that have
  answered at least once), `seen` (the agent's pull-request and issue URLs), `shipped` (the ones delivered),
  `comments_from` (per repository, the fixed stamp from which comments count) and `comments_since` (per
  repository, the moving cursor of the last comment update read).
- `gate.json`, the gate's presentation record: `batch` (`ids`, the unread events presented together, and
  `presented_at`, the times they were presented) and `notes_presented_at` (the last time held notes woke the
  agent).
- `audit.jsonl`, append-only action and recovery events. Fresh state is empty.
- `state.lock`, the process lock used for state transactions.

JSON state writes are atomic and all state mutations and JSONL appends are lock-protected. Corrupt JSON state files
are renamed with a `.corrupt-<timestamp>` suffix and bootstrapped again. JSONL files are decoded line by line, and
a line that is not a JSON object is skipped; the gate removes malformed outbox lines and records the count in the
audit log. Timestamps are timezone-aware and stored in Asia/Seoul time. A leftover `monitor.json`, `ticks.jsonl` or
`cursor.json` from an earlier version is deleted on the first run.

## The desire block

```
<desire_state>
agent: <agent>
toward user: closeness strong (09-20) | longing faint (10-08) | trust some (10-01)
toward self: tiredness some (10-08) | traction faint (10-07)
toward world: curiosity some (09-28)
how I am: <the agent's own text>
recent:
- <MM-DD> "<fact>" — "<reading text>"
- <MM-DD> "<fact>"
waiting for my reading: 1 event
to record how you took something: act.py feel --help
last interaction: <YYYY-MM-DD HH:MM> (3h ago)
returned: after 20h away (one held note fits here)
signal transport: up
last signal: <YYYY-MM-DD HH:MM> — no reply yet (2h)
pent-up (1):
- [<YYYY-MM-DD HH:MM>] <note> (attempts 2)
</desire_state>
```

Every line after `agent:` is omitted when it has nothing to show. One `toward` line per object, in the order
user, self, world, lists every present judgment sorted by name with the day it was written. `how I am:` is
`how.md` flattened to one line. `recent:` lists the three newest events with their latest reading, facts and
readings quoted as data (newlines collapsed, `"` turned into `'`, cut at 300 characters). `waiting for my reading:`
counts the events without a reading. The pointer line appears whenever the block has an event to show or a
waiting count. `returned:` follows the interaction line on a user-message turn that is the first one since the
ingress was unreachable; that turn also records the transport as `up` with `source: user-turn`. `last signal:`
reads `— answered after Nh` once a user turn has followed the delivery. Pent-up lines end with `(attempts N)`
from the second failed delivery on.

In a run the gate started for unread events, the block omits the three `toward` lines, so the agent reads the new
facts before it sees its accumulated judgments. The middleware recognises such a run by the wake line
`desire gate: unread events (<n>)` in the request text and remembers the run's `turn_id`, so the later requests of
the same run omit them too. Conversation turns carry them.

The middleware keeps one in-process turn-cache entry, with a sliding 10-minute expiry, to make repeated provider
calls within a turn byte-stable. The cache key is the state directory, the newest user text, and whether the turn
is gate-started. Interleaved concurrent sessions can evict that entry and lose only the byte-stability
optimization.

## The gate

`gate.py` runs as the tick job's pre-run script. Every run, outside the state lock, it probes the transport and
reads GitHub; inside the lock it bootstraps the state files, resets the daily budget and prunes reservations older
than seven days, expires outbox items past 48 hours, records the transport, records what it saw on GitHub and files
monitor events, decides whether to wake the agent, writes `gate.json` last, and prints.

Stdout is one of:

- `{"wakeAgent": false}`, when neither case holds or the run raised internally (the error is audited as
  `gate_error`);
- `desire gate: unread events (<n>)` and/or `desire gate: held notes (<n>)`.

Case 1, events without a reading. All of them form one batch. The batch wakes the agent when it is new, then again
after six hours, at most three times in total; after that the events stay listed under `waiting for my reading`
and wake nobody. A new event starts a batch holding every currently unread event, with a fresh count. Reading an
event neither wakes the agent nor resets the count.

Case 2, a held note that can be delivered: the transport is `up`, a signal is left in today's budget, and the
note's `not_before` has passed. Held notes wake the agent again only after six hours, except that a note created
after the last such wake wakes it at once.

The one non-zero exit is a missing `DESIRE_AGENT_NAME`, so the misconfiguration reaches the operator through the
scheduler's error block.

### Monitor events

The gate files three kinds of event, each once per `source_ref`, so a repeated sighting files nothing:

| Fact | When | `source_ref` |
| --- | --- | --- |
| `issue <url> was closed` | an issue of the agent (body carries `<!-- from-<agent> -->`) is closed | the issue URL |
| `pull request <url> was merged` | a pull request of the agent (head branch `<agent>/…`) is merged | the pull request URL |
| `<login> commented on <url>` | someone other than the agent, and not a bot, comments on one of them | the comment URL |

Repositories are every directory one level under `~/.hermes/profiles/<profile>/workspace/` whose `.git/config`
names a github.com origin with a plain `owner/name`. Pull requests and issues come from
`gh pr list` and `gh issue list` with `--author @me`; delivery from `gh pr view` and `gh issue view` of each
seen artefact; comments from one `gh api repos/<owner>/<name>/issues/comments?since=<cursor − 60 s>` call per
repository and run, every page. The agent's login comes from `gh api user`.

A source's first answer records everything it reports as seen or shipped without filing an event. A repository's
comment stamps are created on a run where the login call and both artefact kinds answered, and advance only on
such runs; delivery events are filed only for a repository whose stamps existed before the run, so a repository
added to the workspace later does not file one event per already-closed issue. A failing call audits
`derive_failed` naming the source and leaves that source's record untouched.

## Install

The install procedure is also packaged as a Hermes skill at `skills/yui-desire-install/SKILL.md`. Registering the
`skills/` directory in the profile `config.yaml` makes the agent able to run the install itself:

```yaml
skills:
  external_dirs:
    - <abs>/integrations/hermes/desire/skills
```

On the Hermes host, clone the YUI repository and link the plugin directory into the Hermes plugin directory:

```bash
ln -s <abs>/integrations/hermes/desire ~/.hermes/plugins/yui-desire
hermes -p <profile> plugins enable yui-desire
```

Set the plugin's settings in the profile `.env` (`~/.hermes/profiles/<profile>/.env`):

```
DESIRE_AGENT_NAME=<agent>
DESIRE_STATE_DIR=<home>/.hermes/profiles/<profile>/desire
DESIRE_CHAT_PLATFORMS=<the Hermes chat platforms the user speaks to the agent on>
```

`DESIRE_AGENT_NAME` and `DESIRE_CHAT_PLATFORMS` are required; `DESIRE_STATE_DIR` is optional when the default
profile path is appropriate. The plugin reads these settings per profile, so a gateway that serves several
profiles from one process gives each profile its own values.

The helper and the gate run in a subprocess, and Hermes forwards a profile `.env` value to a subprocess only for
the names the profile's `config.yaml` lists under `terminal.env_passthrough`:

```yaml
terminal:
  env_passthrough:
    - DESIRE_AGENT_NAME
    - DESIRE_STATE_DIR
    - YUI_SIGNALS_URL
```

The shell commands below read `$DESIRE_AGENT_NAME`, `$DESIRE_STATE_DIR`, and `$YUI_SIGNALS_URL`; load them with
`set -a; . ~/.hermes/profiles/<profile>/.env; set +a`.

`DESIRE_CHAT_PLATFORMS` is a comma-separated list of Hermes platform names (`telegram`, `discord`, `slack`, …); a
turn Hermes attributes to one of them counts as the user speaking even when it carries no `<client_context>`.

`YUI_SIGNALS_URL` defaults to `http://127.0.0.1:8770/signals`, which assumes Hermes and YUI share a host. The
`/signals` ingress listens only while Settings → Proactive → Agent notifications is on in YUI, and toggling it
requires an app restart. When Hermes runs on a remote host, such as when it reaches YUI through an SSH reverse
tunnel, `YUI_SIGNALS_URL` must be set to the tunnel endpoint.

The gate reads GitHub with `gh`, so the gateway user's `gh` must be authenticated; `gh auth status` from that user's
shell shows it. On a gateway that serves several profiles, a `GH_TOKEN` in the profile `.env` reaches the gate only
when `env_passthrough` lists it.

A profile's pre-run scripts live under `~/.hermes/profiles/<profile>/scripts/`, and Hermes resolves symlinks before
checking that a script stays inside that directory, so a symlink into the YUI checkout is rejected. Install the gate
as a real file that execs `gate.py` by absolute path:

```bash
printf '#!/bin/sh\nexec python3 <abs>/integrations/hermes/desire/gate.py\n' \
  > ~/.hermes/profiles/<profile>/scripts/$DESIRE_AGENT_NAME-desire-gate.sh
chmod +x ~/.hermes/profiles/<profile>/scripts/$DESIRE_AGENT_NAME-desire-gate.sh
```

`scripts/desire-gate.sh` in the checkout is self-locating and serves direct execution from the repository.

Create the tick, weekly reflection, and daily report jobs with these commands, where `<target>` is a delivery
target Hermes accepts for a channel the profile is connected to, such as `telegram:<chat_id>` for a DM listed in
`~/.hermes/profiles/<profile>/channel_directory.json`:

```bash
hermes -p <profile> cron create "every 10m" --name "$DESIRE_AGENT_NAME-desire-tick" \
  --script "$DESIRE_AGENT_NAME-desire-gate.sh" \
  --deliver <target> \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/tick.md. The configured environment is DESIRE_STATE_DIR=$DESIRE_STATE_DIR and YUI_SIGNALS_URL=$YUI_SIGNALS_URL, on Hermes profile <profile>."
hermes -p <profile> cron create "0 23 * * 0" --name "$DESIRE_AGENT_NAME-desire-reflection" \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/reflection.md. The configured environment is DESIRE_STATE_DIR=$DESIRE_STATE_DIR and YUI_SIGNALS_URL=$YUI_SIGNALS_URL, on Hermes profile <profile>."
hermes -p <profile> cron create "0 21 * * *" --name "$DESIRE_AGENT_NAME-desire-report" \
  --deliver <target> \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/report.md. The configured environment is DESIRE_STATE_DIR=$DESIRE_STATE_DIR and YUI_SIGNALS_URL=$YUI_SIGNALS_URL, on Hermes profile <profile>."
```

A profile whose tick job was created with `--monitor-script` is moved to the gate with one command, after the gate
wrapper above exists:

```bash
hermes -p <profile> cron edit "$DESIRE_AGENT_NAME-desire-tick" \
  --script "$DESIRE_AGENT_NAME-desire-gate.sh" --monitor-script ""
```

The old monitor wrapper under `~/.hermes/scripts/` can then be deleted. `wants.md`, `audit.jsonl`,
`outbox.jsonl`, `budget.json`, `transport.json` and `artefacts.json` carry over; `drives.json` keeps its stamps;
the gate deletes `monitor.json`, `ticks.jsonl` and `cursor.json` on its first run; the logs start empty.

## The helper

`act.py` runs in the agent's terminal with `DESIRE_STATE_DIR` exported. Exit codes: 0 done, 1 blocked (the reason
printed), 2 usage error, 3 unknown id. The `yui-desire` skill under `skills/` is the agent-facing description of
these commands.

| Command | What it does |
| --- | --- |
| `feel --fact "<text>" --text "<text>" [--source-ref <ref>]` | files an event with `source: agent` and its reading |
| `feel --event <id> --text "<text>"` | files a reading of an existing event |
| `feel --list [--all]` | prints the twenty most recent events with their readings (every event with `--all`) |
| `feel --grounds <name> --toward <t>` | prints the events behind a present judgment |
| `correct <id> --fact "<text>"` | appends a correction (exit 1 for a retracted event) |
| `retract <id> --why "<text>"` | appends a retraction (`already retracted <id>` when it was) |
| `judge "<name>" --toward <t> --level <l> [--event <id> ...] [--why "<text>"]` | appends a judgment |
| `judge "<name>" --toward <t> --put-down [--why "<text>"]` | puts a judgment down |
| `judge --list` | prints every present judgment |
| `how "<text>"` | writes `how.md` (exit 1 over 500 characters) |
| `signal --note "<text>"` | posts a signal to the YUI ingress |
| `outbox --list` and `--send`, `--repeat`, `--reword`, `--postpone`, `--release <id>` | held-note dispositions |
| `issue`, `comment`, `pr` with `--reserve`, `--commit <id> --url <url>`, `--release <id>` | daily-cap reservations |
| `report --note "<text>"` | posts the daily report to the ingress |

## Action budgets

`act.py` enforces caps that reset at KST midnight: three signals, two issues, one self-initiated comment, and zero
pull requests, so `pr --reserve` always refuses and the agent opens no pull requests. Replies to the user's
comments are not routed through this helper and are uncapped.
`signal --note` posts a new note; `outbox --send <id>` posts an existing held note and shares the same budget.
Signal reservations are refunded after a delivery failure; a failed new note enters the outbox with `attempts` 1,
and a failed resend increments the existing item's `attempts` instead of adding another item. `outbox --list`
shows only active (unexpired) items, marking a postponed one with `postponed_until`.
`--send` accepts only the ids the desire block shows. `outbox --send` exits 0 after delivery, 1 when blocked or
failed, and 3 for an unknown id.

One held note takes one disposition: `outbox --repeat <id>` keeps it as it is, `outbox --reword <id> --note
"<text>"` replaces its text in place and keeps its `id`, `created_at`, and `attempts`, `outbox --postpone <id>
[--until <hours>]` hides it until then (default 24, from more than 0 up to 8760), and `outbox --release <id>`
drops it. All four take a required `--why`, act on active items, append an `outbox_disposition` audit event, exit
2 when `--why` (or `--note` with `--reword`) is missing, and exit 3 for an unknown id. Issue, comment, and
pull-request actions use reserve, commit, and release commands so external `gh` calls do not hold the state lock.
`<kind> --reserve` prints a reservation id and takes the slot, `<kind> --commit <id> --url <url>` audits
`issue_filed`, `self_comment_filed`, or `pr_filed`, and `<kind> --release <id>` gives the slot back. Pending
reservations survive midnight; the gate prunes reservations older than seven days.

`report --note "<text>"` posts the daily report to the same ingress, with `report` as the signal kind and
`desire.report` as the event type. It takes no budget, never enters the outbox, records the transport outcome
like a signal delivery, and audits `report_sent` or `report_failed`.

## Verify

```bash
cd integrations/hermes/desire
uv run pytest
uv run ruff format --check .
uv run ruff check .
```

With `logging.level: DEBUG` in the Hermes profile `config.yaml`, every middleware pass writes one
`yui-desire llm_request …` line to `~/.hermes/logs/agent.log` carrying only outcome, skip reason, trigger
class, the trigger kind read off the headline `trigger:` line of the last `<client_context>` block
(`trigger=user message`, `proactive`, `screen`, `agent`, `signals`, `other` for any headline outside that
vocabulary, or `none` without a block), the channel Hermes named for the turn (`platform=<name>`, or `none` when
it named none), request shape, cache-hit status, and the Hermes request/turn/session ids, never the desire block
or user text.

A turn counts as an interaction, and moves the interaction time, when that headline is `trigger: user message` or
when Hermes names a platform listed in `DESIRE_CHAT_PLATFORMS`.

Each `<client_context>` block the middleware sees for the first time also appends a `turn` event carrying that
trigger kind and whether the run was gate-started to `audit.jsonl`, whatever the log level. A cache hit or a
request repeating the text of the one before it appends nothing, so the events count distinct turns.
