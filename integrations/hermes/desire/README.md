# yui-desire

`yui-desire` is the Hermes-side desire system for Natsume. Its `llm_request` middleware injects a compact
`<desire_state>` block into the newest user message, while the monitor advances drives, scores the artefacts
Natsume produced outside the state directory, and wakes a Hermes cron turn only when its one-line summary changes. Wants, judgment, feedback handling, and speech decisions remain in
Hermes; YUI receives desire speech through its existing `/signals` ingress.

The integration is a self-contained Python 3.10+ uv project. Runtime code uses only the Python standard library.

## State

State lives in `DESIRE_STATE_DIR` when set. Otherwise it resolves to
`~/.hermes/profiles/$HERMES_PROFILE/desire/`, with `HERMES_PROFILE` defaulting to `natsume2`.

The state directory contains:

- `drives.json` — curiosity and accomplishment levels and anchors, plus the latest interaction time and hash and
  the signal stamps `last_signal_at` (the last delivered signal) and `last_signal_answered_at` (the first user turn
  after it). Fresh state starts both stored drives at `50.0`, anchored at bootstrap time. The interaction time also
  starts at bootstrap time, and its hash and both signal stamps start as `null`. Social drive is derived from the
  interaction time and is not stored.
- `wants.md` — Natsume's own prose record of 3–5 open wants, progress, feedback, and completed or abandoned wants.
  Integration code never parses this file.
- `outbox.jsonl` — pent-up desire notes blocked by a daily budget or signal-delivery error. An item persists here,
  and in the pent-up section of the desire block, until it is delivered (`act.py outbox --send`), released
  (`act.py outbox --release`), or expires 48 hours after `created_at`. Each item carries `attempts`, the number of
  failed deliveries so far, and `last_failed_at`. A failed resend updates the item in place and keeps its
  `created_at`. A postponed item also carries `not_before`, the time it becomes visible again; it keeps ageing
  toward the same expiry while it is hidden. Fresh state is empty.
- `transport.json` — whether the YUI signals ingress is reachable: `state` (`up` or `down`), `since` (when the
  current state began), `failed` (consecutive failures, zero while up), `last_checked_at`, and `source`, which
  names what last wrote the record: `probe` for the monitor, `delivery` for a signal delivery, `user-turn` for a
  user message that reached Hermes through YUI. A return read off an already-`up` transport writes nothing, so
  `probe` stays. The monitor
  refreshes it every tick with an HTTP GET to `YUI_SIGNALS_URL`, treating any HTTP response as reachable, and every signal delivery
  outcome updates it too. Absent until the first tick or delivery.
- `budget.json` — KST daily counters for signals, issues, self-initiated comments, pull requests, dispatches, and
  satisfaction events, plus pending issue, comment, pull-request, and dispatch reservations. Fresh counters are
  zero and `pending` is empty.
- `artefacts.json` — what the monitor has already scored: `bootstrapped_at`, `seen` (the pull-request and issue
  URLs and the skill paths it has counted, one list per kind), `shipped` (the URLs it has counted as delivered),
  `notes_since` (the memory-note cursor), and `unreported` (the events the desire block has not shown yet, each
  `{"event", "kind", "ref", "at"}`). Absent until the first tick, which writes it without dosing.
- `cursor.json` — the feedback cursor. `last_feedback_check_at` starts at bootstrap time.
- `monitor.json` — the buckets the monitor summary prints, the count of drive rises behind them, and how long
  each drive has stood at its ceiling: `latched` is the bucket printed for each drive, `natural` the bucket each
  drive actually stood in at the last tick, `rises` the running number of times a drive has climbed into a
  higher bucket, and `saturated_since` the time each drive reached 100, or `null` while it stands below. Fresh
  state latches the current buckets with `rises` zero and every drive unsaturated.
- `audit.jsonl` — append-only action and recovery events. Fresh state is empty.
- `ticks.jsonl` — one line per monitor tick, holding what the one-line summary discards: `at`, the three
  drive levels rounded to one decimal, `transport`, `outbox` (the visible pent-up count), and
  `last_interaction_at`. Fresh state is empty.
- `state.lock` — the process lock used for state transactions.

JSON state writes are atomic and all state mutations and JSONL appends are lock-protected. Corrupt JSON state files
are renamed with a `.corrupt-<timestamp>` suffix and bootstrapped again. Malformed JSONL lines are skipped; the
monitor removes malformed outbox lines and records the count in the audit log. Timestamps are timezone-aware and
stored in Asia/Seoul time.

An outbox item stays pent-up across every tick until Natsume explicitly releases it (`act.py outbox --release`) or it
ages past the 48-hour hard expiry, which the monitor enforces. Surfacing (the item was submitted in a provider
payload) stamps `surfaced_at` once for record-keeping, but no longer retires the item on its own; if the provider call
then fails, the note simply stays pent-up like any other unreleased item.

The desire block opens with the drive levels, then `last interaction: YYYY-MM-DD HH:MM (Nh ago)` from the
interaction time in `drives.json`, then `signal transport: up`, `signal transport: down since YYYY-MM-DD HH:MM
(N failed)`, or `signal transport: unknown` when `transport.json` is absent.

`returned: after Nh away` follows the interaction line on a user-message turn that is the
first one since the ingress was unreachable — the transport is `down`, or it is `up` with a `since` later than the
interaction time. That turn also records the transport as `up` with `source: user-turn`, and moves the interaction
time to itself whatever the gap, so the next turn is an ordinary one. The line ends with `(one held note fits
here)` while a pent-up note is waiting.

`since last turn: <event> <kind> <ref>; …` follows the transport line while `unreported` in `artefacts.json` is
non-empty. Pull requests, issues, and skills are listed one by one; notes are summarised as `learned N notes`. The
middleware clears `unreported` in the state commit of the turn that rendered the line, so it appears on exactly one
turn.

`last signal: YYYY-MM-DD HH:MM — answered after Nh` follows the transport line once a signal has been delivered and
a user turn has followed it; until then the same line reads `— no reply yet (Nh)`. The line is absent while
`last_signal_at` is `null`. Pent-up lines use
`- [YYYY-MM-DD HH:MM] <note>` while fresh, add `(waited Nh, heavy)` once the note is at least six hours old, use
`(waited Nh, bursting)` once it is at least 18 hours old, and end with `(attempts N)` from the second failed
delivery on.

The middleware keeps one in-process turn-cache entry, with a sliding 10-minute expiry, to make repeated provider
calls within a turn byte-stable. Interleaved concurrent sessions can evict that entry and lose only the byte-stability
optimization. Distinct turns with byte-identical newest-user text can share an entry; YUI's per-turn `time:` line
normally makes those texts distinct. The state commit phase writes interaction state, then outbox surfacing stamps,
then the in-memory cache. A process crash during that phase can leave a partial commit; version 1 does not journal or
roll it back.

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
hermes -p "$HERMES_PROFILE" plugins enable yui-desire
```

Set the deployment environment for the plugin, cron jobs, monitor, and helper commands:

```bash
export HERMES_PROFILE=natsume2
export DESIRE_STATE_DIR="$HOME/.hermes/profiles/$HERMES_PROFILE/desire"
export MEMORY_BASE_URL=http://127.0.0.1:8010
export MEMORY_BASE_API_KEY=<the memory_base key>
```

`DESIRE_STATE_DIR` is optional when the default profile path is appropriate, and `MEMORY_BASE_URL` when memory_base
listens on the default port. `MEMORY_BASE_API_KEY` is required for the `learned` source: without it the monitor
audits `derive_failed` for `notes` every tick and no note is ever scored. `YUI_SIGNALS_URL` defaults to
`http://127.0.0.1:8770/signals`, which assumes Hermes and YUI share a host. The `/signals` ingress listens only while
AgentNotify is enabled in YUI's quick controls, and toggling AgentNotify requires an app restart. When Hermes runs on
a remote host, such as when it reaches YUI through an SSH reverse tunnel, `YUI_SIGNALS_URL` must be set to the tunnel
endpoint.

Hermes monitor scripts live under `~/.hermes/scripts/`, and Hermes resolves symlinks before checking that a monitor
script stays inside that directory, so a symlink into the YUI checkout is rejected. Install the monitor as a real file
that execs `decay_monitor.py` by absolute path:

```bash
printf '#!/bin/sh\nexec python3 <abs>/integrations/hermes/desire/decay_monitor.py\n' \
  > ~/.hermes/scripts/natsume-desire-monitor.sh
chmod +x ~/.hermes/scripts/natsume-desire-monitor.sh
```

`scripts/natsume-desire-monitor.sh` in the checkout is self-locating and serves direct execution from the repository.

Create the tick, weekly reflection, and daily report jobs with these commands, where `<chat_id>` is the Telegram
DM listed in `~/.hermes/profiles/$HERMES_PROFILE/channel_directory.json`:

```bash
hermes -p "$HERMES_PROFILE" cron create "every 10m" --name natsume-desire-tick \
  --monitor-script natsume-desire-monitor.sh \
  --deliver telegram:<chat_id> \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/tick.md. The configured environment is HERMES_PROFILE=$HERMES_PROFILE, DESIRE_STATE_DIR=$DESIRE_STATE_DIR, and YUI_SIGNALS_URL=$YUI_SIGNALS_URL."
hermes -p "$HERMES_PROFILE" cron create "0 23 * * 0" --name natsume-desire-reflection \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/reflection.md. The configured environment is HERMES_PROFILE=$HERMES_PROFILE, DESIRE_STATE_DIR=$DESIRE_STATE_DIR, and YUI_SIGNALS_URL=$YUI_SIGNALS_URL."
hermes -p "$HERMES_PROFILE" cron create "0 21 * * *" --name natsume-desire-report \
  --deliver telegram:<chat_id> \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/report.md. The configured environment is HERMES_PROFILE=$HERMES_PROFILE, DESIRE_STATE_DIR=$DESIRE_STATE_DIR, and YUI_SIGNALS_URL=$YUI_SIGNALS_URL."
```

`--deliver telegram:<chat_id>` sends the tick and report responses to that DM; `hermes -p "$HERMES_PROFILE" cron
edit <job_id> --deliver telegram:<chat_id>` sets it on a job that already exists. Hermes delivers a failed run
whatever its response says, so a transient tick failure reaches the DM even though a quiet tick answers
`[SILENT]`. The job prompt is the file reference followed by the three environment values, nothing else; the
prompt file is the only place a job's behaviour is written.

Hermes injects a changed monitor summary into the tick prompt. An unchanged summary suppresses the run. The
summary is one line:

```text
social:<bucket> curiosity:<bucket> accomplishment:<bucket> outbox:<n>[/<stage>] transport:<up|down> budget:<s>/3sig <i>/2iss <c>/1cmt <p>/1pr day:<YYYY-MM-DD> rises:<r> starved:<social>/<curiosity>/<accomplishment>
```

Buckets are `low` (below 40), `mid` (below 70), and `high`, and the three drive tokens print the latched buckets
from `monitor.json`. A drive that falls into a lower bucket keeps the token it had, so a drive the agent has just
satisfied leaves the whole line unchanged. A drive that stands in a higher bucket than it did at the previous tick
adds one to `<r>` and reprints all three tokens at their current buckets. `<n>` counts the visible pent-up notes
and `<stage>` is the stage of the oldest of them (`fresh`, `heavy`, `bursting`), omitted when none are visible; a
postponed note is in neither until its `not_before` passes. `transport` is the probe result of that tick. `day` is
the date of the current wake day, which rolls at 09:00 KST, and the fail-safe fallback line names it too.
`starved` counts, per drive, the whole three-hour periods that drive has stood at 100, and returns to zero for it
as soon as it leaves the ceiling; each drive keeps its own count so one drive leaving the ceiling cannot mask
another crossing a boundary on the same tick. The line therefore changes, and the tick runs, when a drive rises
into a higher bucket, when the oldest visible note crosses six or 18 hours or expires, when a postponed note
comes back, when the YUI ingress becomes reachable or unreachable, when a used budget resets at midnight, when a
drive has sat at 100 for another three hours, and once every morning. Run the one-time instructions in
`prompts/kickoff.md` after installation to create the initial wants without speaking.

## Action budgets

`act.py` enforces caps that reset at KST midnight: three signals, two issues, one self-initiated comment, one pull
request, and one dispatch. Replies to Youngwoo's comments are not routed through this helper and are uncapped.
`signal --note` posts a new note; `outbox --send <id>` posts an existing pent-up note and shares the same budget.
Signal reservations are refunded after a delivery failure; a failed new note enters the outbox with `attempts` 1,
and a failed resend increments the existing item's `attempts` instead of adding another item. `outbox --list`
shows only active (unexpired) items, marking a postponed one with `postponed_until`, so its id stays reachable
while it waits.
`--send` accepts only the ids the desire block shows. `outbox --send` exits 0 after delivery, 1 when blocked or
failed, and 3 for an unknown id.

One pent-up note takes one disposition: `outbox --repeat <id>` keeps it as it is, `outbox --reword <id> --note
"<text>"` replaces its text in place and keeps its `id`, `created_at`, and `attempts`, `outbox --postpone <id>
[--until <hours>]` hides it until then (default 24, from more than 0 up to 8760), and `outbox --release <id>`
drops it. All four take a required
`--why`, act on active items, append an `outbox_disposition` audit event, exit 2 when `--why` (or `--note` with
`--reword`) is missing, and exit 3 for an unknown id. Issue, comment, pull-request, and dispatch actions use
reserve, commit, and release commands so external `gh` and `claude` calls do not hold the state lock.
`<kind> --reserve` prints a reservation id and takes the slot, `<kind> --commit <id> --url <url>` audits
`issue_filed`, `self_comment_filed`, `pr_filed`, or `dispatch_started`, and `<kind> --release <id>` gives the slot
back. `dispatch --commit` also takes `--model <name>` and records it. Pending reservations survive midnight; the
monitor prunes reservations older than seven days.

`report --note "<text>"` posts the daily report to the same ingress, with `report` as the signal kind and
`desire.report` as the event type. It takes no budget, never enters the outbox, records the transport outcome
like a signal delivery, and audits `report_sent` or `report_failed`.

Drives rise linearly while unattended: curiosity 9 points per hour, accomplishment 6 per hour, and social 15 per
hour since the last user message. These observation-phase rates and the caps below are deliberately fast so a full
hunger cycle fits in roughly eight hours and every tick day produces telemetry.

Satisfaction uses fixed event doses and KST daily caps. Three of the four events are derived by the monitor from
artefacts outside the state directory; only `praised` is self-reported, through
`act.py satisfy praised --ref "<what he said and where>"`:

| Event | Applies when | Drive dose | Daily cap |
| --- | --- | --- | ---: |
| `learned` | The monitor sees a `memory_base` note tagged `natsume` whose `kind` is `note` or `decision`, newer than the cursor | curiosity −30 | 6 |
| `progressed` | The monitor first sees a pull request opened from a `natsume/` branch, an issue whose body carries `<!-- from-natsume -->`, or a skill directory under the profile | accomplishment −15 | 6 |
| `shipped` | The monitor sees one of those pull requests merged, or one of those issues closed | accomplishment −40 | 4 |
| `praised` | Natsume reports positive feedback from Youngwoo | accomplishment −25 | 4 |

The homeostatic reward is `r = D(before) - D(after)`, where
`D(levels) = sqrt(sum((level_i / 100)^4 for i in levels))` over social, curiosity, and accomplishment.

## Derived events

Every tick, after the drives advance and before the summary line, the monitor reads four sources and doses each
artefact it has not counted yet through `desire_state.satisfy`. Each derived event is appended to `unreported` and
audited as `drive_satisfied` with its `kind` (`pr`, `issue`, `skill`, `note`) and `ref`.

- **Repositories** — every directory one level under `~/.hermes/profiles/$HERMES_PROFILE/workspace/` whose git
  `origin` remote is on github.com, in both the HTTPS and SSH forms. A directory without such a remote is skipped;
  there is no configured repository list.
- **Pull requests** — `gh pr list --repo <owner/name> --author @me --state all --limit 100`, keeping the ones whose
  head branch starts with `natsume/`. First sight scores `progressed`; a set `mergedAt` scores `shipped` once.
- **Issues** — `gh issue list --repo <owner/name> --author @me --state all --limit 100`, keeping the ones whose body
  contains the literal `<!-- from-natsume -->`. First sight scores `progressed`; a set `closedAt` scores `shipped`
  once.
- **Skills** — every directory under `~/.hermes/profiles/$HERMES_PROFILE/skills/` containing a `SKILL.md`,
  identified by its path relative to the skills root. First sight scores `progressed`.
- **Memory notes** — `GET $MEMORY_BASE_URL/notes?since=<notes_since>&limit=200&tags=natsume` with the header
  `X-API-Key: $MEMORY_BASE_API_KEY`. `MEMORY_BASE_URL` defaults to `http://127.0.0.1:8010`. The `default`
  namespace is shared with other sessions, so the `natsume` tag is what separates Natsume's own notes; `tick.md`
  tells her every note she saves must carry it. Each returned note of kind `note` or `decision` scores `learned`
  with the note id as its `ref`; `episode` notes are ignored. The response carries a day-granular `date` only, so
  a successful fetch advances `notes_since` to the tick time.

A missing `artefacts.json` bootstraps: everything currently visible is recorded as seen, everything already merged
or closed as shipped, `notes_since` as the tick time, and nothing is dosed. A failing `gh` call or memory request
skips that source for the tick, appends a `derive_failed` audit event naming the source, the repository, and a
short error, and leaves that source's cursor untouched; the summary line is printed regardless. An artefact past
its daily cap is still recorded as seen and audited as `satisfy_blocked`; that dose is lost rather than carried
over. Derived events only lower drives, so they never change the latched buckets and never wake the agent.

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
vocabulary, or `none` without a block), the channel Hermes named for the turn (`platform=telegram`, or `none` when
it named none), request shape, cache-hit status, and the Hermes request/turn/session ids — never the desire block,
drive levels, or user text.

A turn counts as an interaction, and moves the interaction time, when that headline is `trigger: user message` or
when Hermes passes `platform: telegram`. A turn with neither, such as a bare API call, leaves social drive rising.

Each `<client_context>` block the middleware sees for the first time also appends a `turn` event carrying that
trigger kind to `audit.jsonl`, whatever the log level. A cache hit or a request repeating the text of the one
before it appends nothing, so the events count distinct turns.
